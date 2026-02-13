use std::collections::HashSet;
use std::sync::{Arc, Mutex, OnceLock};
use tauri::State;

use crate::agents;
use crate::connectors::{self, ConnectorConfig, ConnectorInfo, ConnectorItem};
use crate::db::Database;
use crate::models::*;

static STARTED_ADAPTERS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

fn started_adapters() -> &'static Mutex<HashSet<String>> {
    STARTED_ADAPTERS.get_or_init(|| Mutex::new(HashSet::new()))
}

fn ensure_adapter_started(db: &Arc<Database>, agent_id: &str) -> Result<(), String> {
    let Some(config) = db.get_adapter_config(agent_id).map_err(|e| e.to_string())? else {
        return Ok(());
    };

    let adapter = agents::create_adapter(&config);
    {
        let mut started = started_adapters()
            .lock()
            .map_err(|_| "adapter registry lock poisoned".to_string())?;
        if started.contains(agent_id) {
            match adapter.health_check(agent_id) {
                Ok(health) if health.connected || health.session_active => return Ok(()),
                Ok(_) => {
                    log::warn!(
                        "Adapter for {} was marked started but is unhealthy; restarting",
                        agent_id
                    );
                    started.remove(agent_id);
                }
                Err(error) => {
                    log::warn!("Adapter health check failed for {}: {}", agent_id, error);
                    started.remove(agent_id);
                }
            }
        }
    }

    adapter
        .start(agent_id, db.clone())
        .map_err(|e| e.to_string())?;

    let mut started = started_adapters()
        .lock()
        .map_err(|_| "adapter registry lock poisoned".to_string())?;
    started.insert(agent_id.to_string());

    Ok(())
}

// ── Dashboard ───────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_dashboard(db: State<'_, Arc<Database>>) -> Result<DashboardView, String> {
    let projects = db.list_projects().map_err(|e| e.to_string())?;
    let agents = db.list_agents().map_err(|e| e.to_string())?;

    // Ensure adapter loops are active after app restarts, even before sending a new message.
    for agent in &agents {
        if let Err(error) = ensure_adapter_started(db.inner(), &agent.id) {
            log::warn!("Failed to start adapter for {}: {}", agent.id, error);
        }
    }

    let mut needs_attention: Vec<AttentionItem> = vec![];
    let mut running = 0;
    let mut idle = 0;
    let mut errored = 0;
    let mut total_files_changed = 0;

    let mut project_agents: Vec<ProjectWithAgents> = vec![];

    for project in &projects {
        let project_agent_list: Vec<AgentSummary> = agents
            .iter()
            .filter(|a| a.project_id == project.id)
            .map(|agent| {
                let recent_run = db.get_latest_run_for_agent(&agent.id).unwrap_or(None);
                let files_changed = recent_run
                    .as_ref()
                    .map(|r| r.file_changes.len())
                    .unwrap_or(0);
                total_files_changed += files_changed;

                match agent.status {
                    AgentStatus::Running => running += 1,
                    AgentStatus::Idle => idle += 1,
                    AgentStatus::Errored => {
                        errored += 1;
                        needs_attention.push(AttentionItem {
                            agent_id: agent.id.clone(),
                            agent_name: agent.name.clone(),
                            project_name: project.name.clone(),
                            reason: "errored".to_string(),
                            timestamp: agent.last_active_at.unwrap_or(agent.created_at),
                        });
                    }
                    AgentStatus::Blocked => {
                        needs_attention.push(AttentionItem {
                            agent_id: agent.id.clone(),
                            agent_name: agent.name.clone(),
                            project_name: project.name.clone(),
                            reason: "blocked".to_string(),
                            timestamp: agent.last_active_at.unwrap_or(agent.created_at),
                        });
                    }
                    _ => {}
                }

                // Check for runs needing review
                if let Some(ref run) = recent_run {
                    if run.status == RunStatus::NeedsReview {
                        needs_attention.push(AttentionItem {
                            agent_id: agent.id.clone(),
                            agent_name: agent.name.clone(),
                            project_name: project.name.clone(),
                            reason: "needs_review".to_string(),
                            timestamp: run.started_at,
                        });
                    }
                }

                AgentSummary {
                    agent: agent.clone(),
                    recent_run,
                    files_changed_today: files_changed,
                }
            })
            .collect();

        project_agents.push(ProjectWithAgents {
            project: project.clone(),
            agents: project_agent_list,
        });
    }

    let total_agents = agents.len();
    let needs_attention_count = needs_attention.len();

    Ok(DashboardView {
        projects: project_agents,
        needs_attention,
        stats: DashboardStats {
            total_agents,
            running,
            idle,
            errored,
            needs_attention: needs_attention_count,
            files_changed_today: total_files_changed,
        },
    })
}

// ── Agent detail ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_agent_detail(
    db: State<'_, Arc<Database>>,
    agent_id: String,
) -> Result<AgentDetail, String> {
    let agents = db.list_agents().map_err(|e| e.to_string())?;
    let agent = agents
        .into_iter()
        .find(|a| a.id == agent_id)
        .ok_or("Agent not found")?;

    let runs = db
        .get_runs_for_agent(&agent_id, 20)
        .map_err(|e| e.to_string())?;

    let mut messages = db
        .get_messages_for_agent(&agent_id, 50)
        .map_err(|e| e.to_string())?;
    messages.reverse(); // oldest first for display

    let adapter_config = db
        .get_adapter_config(&agent_id)
        .map_err(|e| e.to_string())?;

    Ok(AgentDetail {
        agent,
        runs,
        messages,
        adapter_config,
    })
}

#[derive(serde::Serialize)]
pub struct AgentDetail {
    pub agent: Agent,
    pub runs: Vec<Run>,
    pub messages: Vec<Message>,
    pub adapter_config: Option<AdapterConfig>,
}

// ── Agent management ────────────────────────────────────────────────────────

#[tauri::command]
pub fn create_project(
    db: State<'_, Arc<Database>>,
    name: String,
    color: String,
) -> Result<Project, String> {
    let project = Project::new(&name, &color);
    db.create_project(&project).map_err(|e| e.to_string())?;
    Ok(project)
}

#[tauri::command]
pub fn list_project_context_docs(
    db: State<'_, Arc<Database>>,
    project_id: String,
) -> Result<Vec<ProjectContextDocument>, String> {
    db.list_project_context_docs(&project_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_project_context_doc(
    db: State<'_, Arc<Database>>,
    project_id: String,
    doc_id: Option<String>,
    title: String,
    content: String,
) -> Result<ProjectContextDocument, String> {
    let normalized_title = {
        let trimmed = title.trim();
        if trimmed.is_empty() {
            "Untitled context".to_string()
        } else {
            trimmed.to_string()
        }
    };

    let now = chrono::Utc::now();
    let mut doc = if let Some(doc_id) = doc_id {
        if let Some(mut existing) = db
            .get_project_context_doc(&doc_id)
            .map_err(|e| e.to_string())?
        {
            if existing.project_id != project_id {
                return Err("Context document does not belong to this project".to_string());
            }
            existing.title = normalized_title;
            existing.content = content;
            existing.updated_at = now;
            existing
        } else {
            ProjectContextDocument {
                id: doc_id,
                project_id: project_id.clone(),
                title: normalized_title,
                content,
                created_at: now,
                updated_at: now,
            }
        }
    } else {
        ProjectContextDocument::new(&project_id, &normalized_title, &content)
    };

    // Keep newly created docs deterministic in case caller provided explicit id.
    if doc.created_at > doc.updated_at {
        doc.updated_at = doc.created_at;
    }

    db.save_project_context_doc(&doc)
        .map_err(|e| e.to_string())?;
    Ok(doc)
}

#[tauri::command]
pub fn delete_project_context_doc(
    db: State<'_, Arc<Database>>,
    doc_id: String,
) -> Result<(), String> {
    db.delete_project_context_doc(&doc_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_agent(
    db: State<'_, Arc<Database>>,
    name: String,
    project_id: String,
    kind: AgentKind,
    function_tag: String,
    working_directory: Option<String>,
) -> Result<Agent, String> {
    let mut agent = Agent::new(&name, &project_id, kind, &function_tag);
    agent.working_directory = working_directory;
    db.create_agent(&agent).map_err(|e| e.to_string())?;
    Ok(agent)
}

#[tauri::command]
pub fn update_agent_status(
    db: State<'_, Arc<Database>>,
    agent_id: String,
    status: AgentStatus,
) -> Result<(), String> {
    db.update_agent_status(&agent_id, &status)
        .map_err(|e| e.to_string())
}

// ── Message Bus ─────────────────────────────────────────────────────────────

/// Send an instruction to an agent. The message goes into the bus and the
/// adapter picks it up on its next poll cycle.
#[tauri::command]
pub fn send_message(
    db: State<'_, Arc<Database>>,
    agent_id: String,
    kind: MessageKind,
    content: String,
    reply_to: Option<String>,
) -> Result<Message, String> {
    let mut msg = Message::to_agent(&agent_id, kind, &content);
    msg.reply_to = reply_to;
    db.insert_message(&msg).map_err(|e| e.to_string())?;

    match msg.kind {
        MessageKind::Instruction | MessageKind::Resume => {
            if let Err(error) = db.start_instruction_run(&agent_id, &msg.content) {
                log::warn!("Failed to start run for {}: {}", agent_id, error);
            }
            let _ = db.update_agent_status(&agent_id, &AgentStatus::Running);
        }
        MessageKind::Pause => {
            if let Err(error) = db.append_run_output(&agent_id, "pause", &msg.content) {
                log::warn!("Failed to append pause output for {}: {}", agent_id, error);
            }
            let _ = db.update_agent_status(&agent_id, &AgentStatus::Blocked);
        }
        MessageKind::Cancel => {
            if let Err(error) = db.append_run_output(&agent_id, "cancel", &msg.content) {
                log::warn!("Failed to append cancel output for {}: {}", agent_id, error);
            }
            if let Err(error) = db.finalize_latest_run(
                &agent_id,
                RunStatus::Failed,
                Some("Cancelled by operator".to_string()),
            ) {
                log::warn!(
                    "Failed to finalize cancelled run for {}: {}",
                    agent_id,
                    error
                );
            }
            let _ = db.update_agent_status(&agent_id, &AgentStatus::Idle);
        }
        _ => {}
    }

    // Ensure the adapter loop is running so queued messages are picked up.
    if let Err(error) = ensure_adapter_started(db.inner(), &agent_id) {
        log::warn!("Failed to start adapter for {}: {}", agent_id, error);
    }

    Ok(msg)
}

/// Get conversation thread for an agent
#[tauri::command]
pub fn get_conversation(
    db: State<'_, Arc<Database>>,
    agent_id: String,
    limit: Option<usize>,
) -> Result<ConversationThread, String> {
    let limit = limit.unwrap_or(50);
    let mut messages = db
        .get_messages_for_agent(&agent_id, limit)
        .map_err(|e| e.to_string())?;

    let has_more = messages.len() == limit;

    // Reverse so oldest first for display
    messages.reverse();

    Ok(ConversationThread {
        agent_id,
        messages,
        has_more,
    })
}

/// Called by adapters to post a response from an agent
#[tauri::command]
pub fn receive_message(
    db: State<'_, Arc<Database>>,
    agent_id: String,
    kind: MessageKind,
    content: String,
    metadata: Option<serde_json::Value>,
    reply_to: Option<String>,
) -> Result<Message, String> {
    let mut msg = Message::from_agent(&agent_id, kind, &content);
    msg.metadata = metadata;
    msg.reply_to = reply_to;
    db.insert_message(&msg).map_err(|e| e.to_string())?;

    match msg.kind {
        MessageKind::Output => {
            if let Err(error) = db.append_run_output(&agent_id, "output", &msg.content) {
                log::warn!("Failed to append output for {}: {}", agent_id, error);
            }
        }
        MessageKind::StatusUpdate => {
            if let Err(error) = db.append_run_output(&agent_id, "status_update", &msg.content) {
                log::warn!("Failed to append status update for {}: {}", agent_id, error);
            }
        }
        MessageKind::Heartbeat => {
            if !msg.content.trim().is_empty() {
                if let Err(error) = db.append_run_output(&agent_id, "heartbeat", &msg.content) {
                    log::warn!("Failed to append heartbeat for {}: {}", agent_id, error);
                }
            }
        }
        MessageKind::Error => {
            if let Err(error) = db.append_run_output(&agent_id, "error", &msg.content) {
                log::warn!("Failed to append error output for {}: {}", agent_id, error);
            }
            if let Err(error) =
                db.finalize_latest_run(&agent_id, RunStatus::Failed, Some(msg.content.clone()))
            {
                log::warn!("Failed to finalize failed run for {}: {}", agent_id, error);
            }
        }
        MessageKind::Blocked => {
            if let Err(error) = db.append_run_output(&agent_id, "blocked", &msg.content) {
                log::warn!(
                    "Failed to append blocked output for {}: {}",
                    agent_id,
                    error
                );
            }
            if let Err(error) =
                db.finalize_latest_run(&agent_id, RunStatus::NeedsReview, Some(msg.content.clone()))
            {
                log::warn!("Failed to finalize blocked run for {}: {}", agent_id, error);
            }
        }
        MessageKind::Completed => {
            if let Err(error) = db.append_run_output(&agent_id, "completed", &msg.content) {
                log::warn!(
                    "Failed to append completion output for {}: {}",
                    agent_id,
                    error
                );
            }
            if let Err(error) =
                db.finalize_latest_run(&agent_id, RunStatus::Completed, Some(msg.content.clone()))
            {
                log::warn!(
                    "Failed to finalize completed run for {}: {}",
                    agent_id,
                    error
                );
            }
        }
        _ => {}
    }

    // Auto-update agent status based on message kind
    let new_status = match msg.kind {
        MessageKind::StatusUpdate | MessageKind::Heartbeat => Some(AgentStatus::Running),
        MessageKind::Output => Some(AgentStatus::Running),
        MessageKind::Error => Some(AgentStatus::Errored),
        MessageKind::Blocked => Some(AgentStatus::Blocked),
        MessageKind::Completed => Some(AgentStatus::Completed),
        _ => None,
    };
    if let Some(status) = new_status {
        let _ = db.update_agent_status(&agent_id, &status);
    }

    Ok(msg)
}

/// Adapters poll this to get pending instructions for their agent
#[tauri::command]
pub fn poll_pending_messages(
    db: State<'_, Arc<Database>>,
    agent_id: String,
) -> Result<Vec<Message>, String> {
    let messages = db
        .get_pending_messages(&agent_id)
        .map_err(|e| e.to_string())?;
    // Mark them as delivered
    for msg in &messages {
        let _ = db.mark_delivered(&msg.id);
    }
    Ok(messages)
}

// ── Adapter Config ──────────────────────────────────────────────────────────

#[tauri::command]
pub fn set_adapter_config(
    db: State<'_, Arc<Database>>,
    agent_id: String,
    config: AdapterConfig,
) -> Result<(), String> {
    if let Some(existing_config) = db
        .get_adapter_config(&agent_id)
        .map_err(|e| e.to_string())?
    {
        let existing = agents::create_adapter(&existing_config);
        if let Err(error) = existing.stop(&agent_id) {
            log::warn!(
                "Failed stopping existing adapter for {} before reconfigure: {}",
                agent_id,
                error
            );
        }
    }

    db.set_adapter_config(&agent_id, &config)
        .map_err(|e| e.to_string())?;

    if let Ok(mut started) = started_adapters().lock() {
        started.remove(&agent_id);
    }

    if let Err(error) = ensure_adapter_started(db.inner(), &agent_id) {
        log::warn!("Failed to start adapter for {}: {}", agent_id, error);
    }

    Ok(())
}

#[tauri::command]
pub fn get_adapter_health(
    db: State<'_, Arc<Database>>,
    agent_id: String,
) -> Result<Option<agents::AdapterHealth>, String> {
    let Some(config) = db
        .get_adapter_config(&agent_id)
        .map_err(|e| e.to_string())?
    else {
        return Ok(None);
    };

    let adapter = agents::create_adapter(&config);
    adapter
        .health_check(&agent_id)
        .map(Some)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn restart_adapter(
    db: State<'_, Arc<Database>>,
    agent_id: String,
) -> Result<Option<agents::AdapterHealth>, String> {
    let Some(config) = db
        .get_adapter_config(&agent_id)
        .map_err(|e| e.to_string())?
    else {
        return Ok(None);
    };

    let adapter = agents::create_adapter(&config);
    if let Err(error) = adapter.stop(&agent_id) {
        log::warn!(
            "Failed stopping adapter for {} during restart: {}",
            agent_id,
            error
        );
    }

    if let Ok(mut started) = started_adapters().lock() {
        started.remove(&agent_id);
    }

    ensure_adapter_started(db.inner(), &agent_id)?;

    let healthy_adapter = agents::create_adapter(&config);
    healthy_adapter
        .health_check(&agent_id)
        .map(Some)
        .map_err(|e| e.to_string())
}

// ── Connectors ──────────────────────────────────────────────────────────────

/// List all configured connectors with their current status
#[tauri::command]
pub async fn list_connectors(db: State<'_, Arc<Database>>) -> Result<Vec<ConnectorInfo>, String> {
    let configs = db.list_connector_configs().map_err(|e| e.to_string())?;
    let mut infos = Vec::new();

    for config in &configs {
        match connectors::create_connector(config) {
            Ok(connector) => {
                let mut info = connector.info();
                // Update status from health check
                match connector.health_check().await {
                    Ok(status) => info.status = status,
                    Err(_) => info.status = connectors::ConnectorStatus::Error,
                }
                infos.push(info);
            }
            Err(e) => {
                log::warn!(
                    "Failed to create connector {}: {}",
                    config.connector_type,
                    e
                );
            }
        }
    }
    Ok(infos)
}

/// Add or update a connector configuration
#[tauri::command]
pub fn save_connector(db: State<'_, Arc<Database>>, config: ConnectorConfig) -> Result<(), String> {
    db.save_connector_config(&config).map_err(|e| e.to_string())
}

/// List saved connector configs (including settings/auth placeholders)
#[tauri::command]
pub fn get_connector_configs(db: State<'_, Arc<Database>>) -> Result<Vec<ConnectorConfig>, String> {
    db.list_connector_configs().map_err(|e| e.to_string())
}

/// Pull items from a connector and cache them locally
#[tauri::command]
pub async fn sync_connector(
    db: State<'_, Arc<Database>>,
    connector_type: String,
) -> Result<connectors::SyncResult, String> {
    let config = db
        .get_connector_config(&connector_type)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Connector '{}' not configured", connector_type))?;

    let connector = connectors::create_connector(&config).map_err(|e| e.to_string())?;

    let items = connector.pull(None).await.map_err(|e| e.to_string())?;
    let count = items.len();

    db.upsert_connector_items(&connector_type, &items)
        .map_err(|e| e.to_string())?;

    Ok(connectors::SyncResult {
        connector_id: connector_type,
        pulled: count,
        pushed: 0,
        errors: vec![],
        synced_at: chrono::Utc::now(),
    })
}

/// Get cached items from a connector (from local DB, no network call)
#[tauri::command]
pub fn get_connector_items(
    db: State<'_, Arc<Database>>,
    connector_type: String,
) -> Result<Vec<ConnectorItem>, String> {
    db.get_connector_items(&connector_type)
        .map_err(|e| e.to_string())
}

/// Push a new item to a connector
#[tauri::command]
pub async fn push_connector_item(
    db: State<'_, Arc<Database>>,
    connector_type: String,
    item: ConnectorItem,
) -> Result<ConnectorItem, String> {
    let config = db
        .get_connector_config(&connector_type)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Connector '{}' not configured", connector_type))?;

    let connector = connectors::create_connector(&config).map_err(|e| e.to_string())?;

    let created = connector.push(&item).await.map_err(|e| e.to_string())?;

    // Cache the new item locally
    db.upsert_connector_items(&connector_type, &[created.clone()])
        .map_err(|e| e.to_string())?;

    Ok(created)
}

/// Delete an item from a connector
#[tauri::command]
pub async fn delete_connector_item(
    db: State<'_, Arc<Database>>,
    connector_type: String,
    item_id: String,
) -> Result<(), String> {
    let config = db
        .get_connector_config(&connector_type)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Connector '{}' not configured", connector_type))?;

    let connector = connectors::create_connector(&config).map_err(|e| e.to_string())?;

    connector
        .delete(&item_id)
        .await
        .map_err(|e| e.to_string())?;

    db.delete_connector_item(&connector_type, &item_id)
        .map_err(|e| e.to_string())?;

    Ok(())
}
