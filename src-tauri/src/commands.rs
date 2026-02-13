use chrono::Utc;
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::State;

use crate::agents;
use crate::connectors::{self, ConnectorConfig, ConnectorInfo, ConnectorItem};
use crate::db::Database;
use crate::models::*;

#[derive(Debug, Clone, Default)]
struct AdapterRuntimeState {
    started: bool,
    consecutive_failures: u32,
    next_retry_at: Option<Instant>,
    last_error: Option<String>,
    last_failure_at: Option<chrono::DateTime<chrono::Utc>>,
    last_started_at: Option<chrono::DateTime<chrono::Utc>>,
}

impl AdapterRuntimeState {
    fn retry_after_seconds(&self) -> Option<u64> {
        self.next_retry_at.map(|retry_at| {
            let remaining = retry_at.saturating_duration_since(Instant::now());
            remaining.as_secs()
        })
    }
}

static ADAPTER_RUNTIME: OnceLock<Mutex<HashMap<String, AdapterRuntimeState>>> = OnceLock::new();

fn adapter_runtime() -> &'static Mutex<HashMap<String, AdapterRuntimeState>> {
    ADAPTER_RUNTIME.get_or_init(|| Mutex::new(HashMap::new()))
}

fn adapter_runtime_snapshot(agent_id: &str) -> Option<AdapterRuntimeState> {
    adapter_runtime()
        .lock()
        .ok()
        .and_then(|runtime| runtime.get(agent_id).cloned())
}

fn clear_adapter_runtime(agent_id: &str) {
    if let Ok(mut runtime) = adapter_runtime().lock() {
        runtime.remove(agent_id);
    }
}

fn clear_all_adapter_runtime() {
    if let Ok(mut runtime) = adapter_runtime().lock() {
        runtime.clear();
    }
}

fn adapter_retry_backoff(failure_count: u32) -> Duration {
    let exponent = failure_count.saturating_sub(1).min(5);
    Duration::from_secs((1_u64 << exponent) * 2)
}

fn record_adapter_start_failure(
    db: &Arc<Database>,
    agent_id: &str,
    reason: &str,
) -> Result<String, String> {
    let (consecutive_failures, retry_after) = {
        let mut runtime = adapter_runtime()
            .lock()
            .map_err(|_| "adapter runtime lock poisoned".to_string())?;
        let state = runtime.entry(agent_id.to_string()).or_default();
        state.started = false;
        state.consecutive_failures = state.consecutive_failures.saturating_add(1);
        let backoff = adapter_retry_backoff(state.consecutive_failures);
        state.next_retry_at = Some(Instant::now() + backoff);
        state.last_error = Some(reason.to_string());
        state.last_failure_at = Some(Utc::now());
        (state.consecutive_failures, backoff.as_secs())
    };

    let summary = format!(
        "Adapter unavailable: {}. Auto-retry in {}s (attempt {}).",
        reason, retry_after, consecutive_failures
    );

    let mut error_message = Message::from_agent(agent_id, MessageKind::Error, &summary);
    error_message.metadata = Some(serde_json::json!({
        "source": "adapter_supervisor",
        "retry_after_seconds": retry_after,
        "consecutive_failures": consecutive_failures,
        "reason": reason,
    }));
    let _ = db.insert_message(&error_message);

    if let Ok(Some(run)) = db.get_latest_run_for_agent(agent_id) {
        if run.status == RunStatus::InProgress && run.ended_at.is_none() {
            let _ = db.append_run_output(agent_id, "adapter_error", &summary);
            if consecutive_failures >= 3 {
                let _ = db.finalize_latest_run(
                    agent_id,
                    RunStatus::Failed,
                    Some("Adapter repeatedly failed to restart".to_string()),
                );
            }
        }
    }

    let _ = db.update_agent_status(agent_id, &AgentStatus::Errored);

    Ok(summary)
}

fn ensure_adapter_started(db: &Arc<Database>, agent_id: &str, force: bool) -> Result<(), String> {
    let Some(config) = db.get_adapter_config(agent_id).map_err(|e| e.to_string())? else {
        clear_adapter_runtime(agent_id);
        return Ok(());
    };

    let adapter = agents::create_adapter(&config);
    {
        let mut runtime = adapter_runtime()
            .lock()
            .map_err(|_| "adapter runtime lock poisoned".to_string())?;
        let state = runtime.entry(agent_id.to_string()).or_default();

        if state.started {
            match adapter.health_check(agent_id) {
                Ok(health) if health.connected || health.session_active => return Ok(()),
                Ok(health) if !force && health.suppress_auto_restart.unwrap_or(false) => {
                    state.last_error = health.last_error.clone();
                    return Ok(());
                }
                Ok(_) => {
                    log::warn!(
                        "Adapter for {} was marked started but is unhealthy; restarting",
                        agent_id
                    );
                    state.started = false;
                    state.last_error =
                        Some("health check reported disconnected adapter".to_string());
                }
                Err(error) => {
                    log::warn!("Adapter health check failed for {}: {}", agent_id, error);
                    state.started = false;
                    state.last_error = Some(format!("health check failed: {}", error));
                }
            }
        }

        if !force {
            if let Some(retry_at) = state.next_retry_at {
                if Instant::now() < retry_at {
                    return Ok(());
                }
            }
        }
    }

    match adapter.start(agent_id, db.clone()) {
        Ok(()) => {
            {
                let mut runtime = adapter_runtime()
                    .lock()
                    .map_err(|_| "adapter runtime lock poisoned".to_string())?;
                let state = runtime.entry(agent_id.to_string()).or_default();
                state.started = true;
                state.consecutive_failures = 0;
                state.next_retry_at = None;
                state.last_error = None;
                state.last_failure_at = None;
                state.last_started_at = Some(Utc::now());
            }

            if let Ok(agents) = db.list_agents() {
                if let Some(agent) = agents.into_iter().find(|agent| agent.id == agent_id) {
                    if agent.status == AgentStatus::Errored {
                        let next_status = match db.get_latest_run_for_agent(agent_id) {
                            Ok(Some(run))
                                if run.status == RunStatus::InProgress
                                    && run.ended_at.is_none() =>
                            {
                                AgentStatus::Running
                            }
                            _ => AgentStatus::Idle,
                        };
                        let _ = db.update_agent_status(agent_id, &next_status);
                    }
                }
            }

            Ok(())
        }
        Err(error) => {
            let reason = error.to_string();
            let summary = record_adapter_start_failure(db, agent_id, &reason)?;
            Err(summary)
        }
    }
}

// ── Dashboard ───────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_dashboard(db: State<'_, Arc<Database>>) -> Result<DashboardView, String> {
    let projects = db.list_projects().map_err(|e| e.to_string())?;
    let agents = db.list_agents().map_err(|e| e.to_string())?;

    // Ensure adapter loops are active after app restarts, even before sending a new message.
    for agent in &agents {
        if let Err(error) = ensure_adapter_started(db.inner(), &agent.id, false) {
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
    if let Err(error) = ensure_adapter_started(db.inner(), &agent_id, true) {
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
    before_created_at: Option<String>,
) -> Result<ConversationThread, String> {
    let limit = limit.unwrap_or(50).clamp(1, 500);
    let query_limit = limit.saturating_add(1);
    let mut messages = db
        .get_messages_for_agent_before(&agent_id, query_limit, before_created_at.as_deref())
        .map_err(|e| e.to_string())?;

    let has_more = messages.len() > limit;
    if has_more {
        messages.truncate(limit);
    }

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

    clear_adapter_runtime(&agent_id);

    if let Err(error) = ensure_adapter_started(db.inner(), &agent_id, true) {
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

    if let Err(error) = ensure_adapter_started(db.inner(), &agent_id, false) {
        log::warn!(
            "Failed to ensure adapter running during health check for {}: {}",
            agent_id,
            error
        );
    }

    let adapter = agents::create_adapter(&config);
    let mut health = match adapter.health_check(&agent_id) {
        Ok(health) => health,
        Err(error) => agents::AdapterHealth {
            connected: false,
            session_active: false,
            last_heartbeat: None,
            details: Some(format!("Health check failed: {}", error)),
            retry_after_seconds: None,
            consecutive_failures: None,
            last_error: Some(error.to_string()),
            suppress_auto_restart: None,
        },
    };

    if let Some(state) = adapter_runtime_snapshot(&agent_id) {
        if state.consecutive_failures > 0 {
            health.consecutive_failures = Some(state.consecutive_failures);
        }

        if let Some(retry_after) = state.retry_after_seconds() {
            health.retry_after_seconds = Some(retry_after);
        }

        let retry_after = state.retry_after_seconds();
        if let Some(last_error) = state.last_error.clone() {
            let supervisor_summary = match retry_after {
                Some(retry_after) => format!(
                    "Supervisor: {} start failures. Next retry in {}s.",
                    state.consecutive_failures, retry_after
                ),
                None => format!(
                    "Supervisor: {} start failures recorded.",
                    state.consecutive_failures
                ),
            };
            health.last_error = Some(last_error);
            health.details = Some(match health.details {
                Some(details) if !details.trim().is_empty() => {
                    format!("{}\n\n{}", supervisor_summary, details)
                }
                _ => supervisor_summary,
            });
        }
    }

    Ok(Some(health))
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

    clear_adapter_runtime(&agent_id);

    ensure_adapter_started(db.inner(), &agent_id, true)?;

    let healthy_adapter = agents::create_adapter(&config);
    healthy_adapter
        .health_check(&agent_id)
        .map(Some)
        .map_err(|e| e.to_string())
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct DatabaseSnapshotResult {
    pub path: String,
    pub size_bytes: u64,
    pub completed_at: String,
}

#[tauri::command]
pub fn export_database_snapshot(
    db: State<'_, Arc<Database>>,
    destination_path: String,
) -> Result<DatabaseSnapshotResult, String> {
    let destination_path = destination_path.trim();
    if destination_path.is_empty() {
        return Err("destination path is required".to_string());
    }

    db.export_snapshot_to_path(destination_path)?;
    let size_bytes = std::fs::metadata(destination_path)
        .map(|metadata| metadata.len())
        .unwrap_or(0);

    Ok(DatabaseSnapshotResult {
        path: destination_path.to_string(),
        size_bytes,
        completed_at: Utc::now().to_rfc3339(),
    })
}

#[tauri::command]
pub fn import_database_snapshot(
    db: State<'_, Arc<Database>>,
    source_path: String,
) -> Result<DatabaseSnapshotResult, String> {
    let source_path = source_path.trim();
    if source_path.is_empty() {
        return Err("source path is required".to_string());
    }

    db.import_snapshot_from_path(source_path)?;
    clear_all_adapter_runtime();
    let size_bytes = std::fs::metadata(source_path)
        .map(|metadata| metadata.len())
        .unwrap_or(0);

    Ok(DatabaseSnapshotResult {
        path: source_path.to_string(),
        size_bytes,
        completed_at: Utc::now().to_rfc3339(),
    })
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

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_mock_agent() -> (Arc<Database>, String) {
        let db = Arc::new(Database::new(":memory:").expect("in-memory db should initialize"));

        let project = Project::new("Test Project", "#112233");
        db.create_project(&project).expect("project should insert");

        let agent = Agent::new(
            "Test Agent",
            &project.id,
            AgentKind::Terminal,
            "engineering",
        );
        db.create_agent(&agent).expect("agent should insert");

        let config = AdapterConfig {
            adapter_type: AdapterType::Mock,
            session_name: Some("kanbun".to_string()),
            endpoint: None,
            command: None,
            env: None,
        };
        db.set_adapter_config(&agent.id, &config)
            .expect("adapter config should insert");

        (db, agent.id)
    }

    #[test]
    fn adapter_retry_backoff_grows_and_caps() {
        assert_eq!(adapter_retry_backoff(1).as_secs(), 2);
        assert_eq!(adapter_retry_backoff(2).as_secs(), 4);
        assert_eq!(adapter_retry_backoff(3).as_secs(), 8);
        assert_eq!(adapter_retry_backoff(4).as_secs(), 16);
        assert_eq!(adapter_retry_backoff(5).as_secs(), 32);
        assert_eq!(adapter_retry_backoff(6).as_secs(), 64);
        assert_eq!(adapter_retry_backoff(20).as_secs(), 64);
    }

    #[test]
    fn ensure_adapter_started_bootstraps_runtime_state() {
        let (db, agent_id) = setup_mock_agent();
        clear_adapter_runtime(&agent_id);

        ensure_adapter_started(&db, &agent_id, false).expect("mock adapter should start");

        let state = adapter_runtime_snapshot(&agent_id).expect("runtime state should exist");
        assert!(state.started);
        assert_eq!(state.consecutive_failures, 0);
        assert!(state.next_retry_at.is_none());
        assert!(state.last_error.is_none());

        clear_adapter_runtime(&agent_id);
    }

    #[test]
    fn forced_start_bypasses_retry_cooldown() {
        let (db, agent_id) = setup_mock_agent();
        {
            let mut runtime = adapter_runtime()
                .lock()
                .expect("runtime lock should succeed");
            runtime.insert(
                agent_id.clone(),
                AdapterRuntimeState {
                    started: false,
                    consecutive_failures: 3,
                    next_retry_at: Some(Instant::now() + Duration::from_secs(30)),
                    last_error: Some("simulated failure".to_string()),
                    last_failure_at: Some(Utc::now()),
                    last_started_at: None,
                },
            );
        }

        ensure_adapter_started(&db, &agent_id, false).expect("cooldown check should not fail");
        let cooled = adapter_runtime_snapshot(&agent_id).expect("runtime state should exist");
        assert!(!cooled.started);
        assert_eq!(cooled.consecutive_failures, 3);
        assert!(cooled.retry_after_seconds().is_some());

        ensure_adapter_started(&db, &agent_id, true).expect("forced start should bypass cooldown");
        let recovered = adapter_runtime_snapshot(&agent_id).expect("runtime state should exist");
        assert!(recovered.started);
        assert_eq!(recovered.consecutive_failures, 0);
        assert!(recovered.next_retry_at.is_none());
        assert!(recovered.last_error.is_none());

        clear_adapter_runtime(&agent_id);
    }
}
