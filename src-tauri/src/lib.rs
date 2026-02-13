pub mod agents;
pub mod commands;
pub mod connectors;
pub mod db;
pub mod models;
pub mod seed;
pub mod watchers;

use db::Database;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::Manager;
use tokio::sync::mpsc::error::TryRecvError;

fn env_flag(name: &str) -> bool {
    std::env::var(name)
        .map(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
        .unwrap_or(false)
}

fn copy_legacy_db_files(from_dir: &Path, to_dir: &Path) -> Result<bool, String> {
    let legacy_main = from_dir.join("hypervisor.db");
    if !legacy_main.exists() {
        return Ok(false);
    }

    std::fs::create_dir_all(to_dir).map_err(|error| {
        format!(
            "failed to create app data dir {}: {}",
            to_dir.display(),
            error
        )
    })?;

    for suffix in ["", "-wal", "-shm"] {
        let source = from_dir.join(format!("hypervisor.db{}", suffix));
        let destination = to_dir.join(format!("kanbun.db{}", suffix));
        if !source.exists() || destination.exists() {
            continue;
        }
        std::fs::copy(&source, &destination).map_err(|error| {
            format!(
                "failed to copy {} to {}: {}",
                source.display(),
                destination.display(),
                error
            )
        })?;
        log::info!(
            "Migrated legacy database artifact {} -> {}",
            source.display(),
            destination.display()
        );
    }

    Ok(true)
}

fn migrate_legacy_database(app_data: &Path) {
    if !env_flag("KANBUN_MIGRATE_LEGACY_DB") {
        return;
    }

    let destination_main = app_data.join("kanbun.db");
    if destination_main.exists() {
        return;
    }

    let mut candidates = vec![app_data.to_path_buf()];
    if let Some(parent) = app_data.parent() {
        candidates.push(parent.join("com.hypervisor.app"));
    }

    let mut checked = Vec::<PathBuf>::new();
    for candidate in candidates {
        if checked.contains(&candidate) {
            continue;
        }
        checked.push(candidate.clone());
        match copy_legacy_db_files(&candidate, app_data) {
            Ok(true) => return,
            Ok(false) => continue,
            Err(error) => {
                log::warn!("Legacy database migration failed: {}", error);
                return;
            }
        }
    }
}

fn collect_watch_paths(agent: &models::Agent) -> Vec<String> {
    let mut paths = Vec::new();
    if let Some(working_directory) = &agent.working_directory {
        if !working_directory.trim().is_empty() {
            paths.push(working_directory.clone());
        }
    }
    for path in &agent.config.watch_paths {
        if !path.trim().is_empty() {
            paths.push(path.clone());
        }
    }
    paths
}

fn change_label(change_type: &models::FileChangeType) -> &'static str {
    match change_type {
        models::FileChangeType::Created => "created",
        models::FileChangeType::Modified => "modified",
        models::FileChangeType::Deleted => "deleted",
        models::FileChangeType::Renamed => "renamed",
    }
}

fn spawn_filesystem_watcher(db: Arc<Database>) {
    std::thread::spawn(move || {
        let mut watcher = match watchers::FileSystemWatcher::new() {
            Ok(watcher) => watcher,
            Err(error) => {
                log::warn!("Failed to initialize file watcher: {}", error);
                return;
            }
        };

        let mut watched_pairs = HashSet::<String>::new();
        let mut last_sync = Instant::now() - Duration::from_secs(10);

        loop {
            if last_sync.elapsed() >= Duration::from_secs(5) {
                match db.list_agents() {
                    Ok(agents) => {
                        for agent in agents {
                            for raw_path in collect_watch_paths(&agent) {
                                let expanded_path = shellexpand::tilde(raw_path.trim()).to_string();
                                if expanded_path.is_empty() {
                                    continue;
                                }

                                let canonical_path = std::fs::canonicalize(&expanded_path)
                                    .map(|path| path.to_string_lossy().to_string())
                                    .unwrap_or(expanded_path.clone());
                                let watch_key = format!("{}::{}", agent.id, canonical_path);
                                if watched_pairs.contains(&watch_key) {
                                    continue;
                                }

                                match watcher.watch_path(&expanded_path, &agent.id) {
                                    Ok(true) => {
                                        watched_pairs.insert(watch_key);
                                    }
                                    Ok(false) => {}
                                    Err(error) => {
                                        log::warn!(
                                            "Failed to watch {} for agent {}: {}",
                                            expanded_path,
                                            agent.id,
                                            error
                                        );
                                    }
                                }
                            }
                        }
                    }
                    Err(error) => {
                        log::warn!("Failed to list agents for watcher sync: {}", error);
                    }
                }
                last_sync = Instant::now();
            }

            loop {
                match watcher.receiver.try_recv() {
                    Ok(event) => {
                        let change = event.change.clone();
                        if let Err(error) = db.record_file_change(&event.agent_id, change.clone()) {
                            log::warn!(
                                "Failed to record file change for agent {}: {}",
                                event.agent_id,
                                error
                            );
                            continue;
                        }

                        let _ =
                            db.update_agent_status(&event.agent_id, &models::AgentStatus::Running);

                        let filename = Path::new(&change.path)
                            .file_name()
                            .and_then(|name| name.to_str())
                            .unwrap_or(change.path.as_str());
                        let change_kind = change_label(&change.change_type);
                        let content = format!("File {}: {}", change_kind, filename);

                        let mut message = models::Message::from_agent(
                            &event.agent_id,
                            models::MessageKind::StatusUpdate,
                            &content,
                        );
                        message.metadata = Some(serde_json::json!({
                            "path": change.path,
                            "change_type": change_kind,
                        }));
                        if let Err(error) = db.insert_message(&message) {
                            log::warn!(
                                "Failed to insert watcher status message for agent {}: {}",
                                event.agent_id,
                                error
                            );
                        }
                    }
                    Err(TryRecvError::Empty) => break,
                    Err(TryRecvError::Disconnected) => {
                        log::warn!("File watcher channel disconnected; stopping watcher loop");
                        return;
                    }
                }
            }

            std::thread::sleep(Duration::from_millis(300));
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Initialize database in app data directory
            let app_data = app
                .path()
                .app_data_dir()
                .expect("failed to get app data dir");
            std::fs::create_dir_all(&app_data).expect("failed to create app data dir");
            migrate_legacy_database(&app_data);
            let db_path = app_data.join("kanbun.db");
            let db = Arc::new(
                Database::new(db_path.to_str().unwrap()).expect("failed to initialize database"),
            );

            // Optional sample seed for demos/dev. Disabled by default.
            if env_flag("KANBUN_SEED_SAMPLE_DATA")
                && db.list_projects().unwrap_or_default().is_empty()
            {
                log::info!("Seeding initial data...");
                seed::seed_initial_data(db.as_ref());
            }
            seed::ensure_default_adapter_configs(db.as_ref());
            spawn_filesystem_watcher(db.clone());

            app.manage(db);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_dashboard,
            commands::get_agent_detail,
            commands::create_project,
            commands::list_project_context_docs,
            commands::save_project_context_doc,
            commands::delete_project_context_doc,
            commands::create_agent,
            commands::update_agent_status,
            commands::send_message,
            commands::get_conversation,
            commands::receive_message,
            commands::poll_pending_messages,
            commands::set_adapter_config,
            commands::get_adapter_health,
            commands::restart_adapter,
            commands::list_connectors,
            commands::save_connector,
            commands::get_connector_configs,
            commands::sync_connector,
            commands::get_connector_items,
            commands::push_connector_item,
            commands::delete_connector_item,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
