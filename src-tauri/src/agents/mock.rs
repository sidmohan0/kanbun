use super::{Adapter, AdapterError, AdapterHealth};
use crate::db::Database;
use crate::models::*;
use std::sync::Arc;

/// Mock adapter for testing. Echoes instructions back as completed outputs
/// with a short delay. Useful for developing the UI without real agents.
pub struct MockAdapter;

impl MockAdapter {
    pub fn new() -> Self {
        Self
    }
}

impl Adapter for MockAdapter {
    fn deliver(&self, message: &Message) -> Result<(), AdapterError> {
        log::info!(
            "[MockAdapter] Delivering to {}: {:?} - {}",
            message.agent_id,
            message.kind,
            message.content
        );
        Ok(())
    }

    fn start(&self, agent_id: &str, db: Arc<Database>) -> Result<(), AdapterError> {
        let agent_id = agent_id.to_string();

        std::thread::spawn(move || {
            loop {
                if let Ok(Some(config)) = db.get_adapter_config(&agent_id) {
                    if config.adapter_type != AdapterType::Mock {
                        log::info!(
                            "[MockAdapter] Config switched for {}, stopping mock loop",
                            agent_id
                        );
                        break;
                    }
                }

                std::thread::sleep(std::time::Duration::from_secs(2));

                // Check for pending messages and echo them back
                if let Ok(pending) = db.get_pending_messages(&agent_id) {
                    for msg in pending {
                        let _ = db.mark_delivered(&msg.id);

                        match msg.kind {
                            MessageKind::Instruction | MessageKind::Resume => {
                                let _ = db.start_instruction_run(&agent_id, &msg.content);
                                let _ = db.update_agent_status(&agent_id, &AgentStatus::Running);

                                // Simulate processing delay
                                std::thread::sleep(std::time::Duration::from_secs(1));

                                // Echo back as output
                                let response = Message::from_agent(
                                    &agent_id,
                                    MessageKind::Output,
                                    &format!("[mock] Processed: {}", msg.content),
                                );
                                let _ = db.insert_message(&response);
                                let _ =
                                    db.append_run_output(&agent_id, "output", &response.content);
                                let _ = db.update_agent_status(&agent_id, &AgentStatus::Running);

                                // Mark completed
                                let done = Message::from_agent(
                                    &agent_id,
                                    MessageKind::Completed,
                                    "Task completed (mock)",
                                );
                                let _ = db.insert_message(&done);
                                let _ = db.append_run_output(&agent_id, "completed", &done.content);
                                let _ = db.finalize_latest_run(
                                    &agent_id,
                                    RunStatus::Completed,
                                    Some(done.content.clone()),
                                );
                                let _ = db.update_agent_status(&agent_id, &AgentStatus::Completed);
                            }
                            MessageKind::StatusRequest => {
                                let status = Message::from_agent(
                                    &agent_id,
                                    MessageKind::StatusUpdate,
                                    "Mock adapter healthy; waiting for instructions.",
                                );
                                let _ = db.insert_message(&status);
                                let _ = db.append_run_output(
                                    &agent_id,
                                    "status_update",
                                    &status.content,
                                );
                            }
                            MessageKind::Pause => {
                                let _ = db.append_run_output(&agent_id, "pause", &msg.content);
                                let _ = db.update_agent_status(&agent_id, &AgentStatus::Blocked);
                                let blocked = Message::from_agent(
                                    &agent_id,
                                    MessageKind::Blocked,
                                    "Paused by operator",
                                );
                                let _ = db.insert_message(&blocked);
                            }
                            MessageKind::Cancel => {
                                let _ = db.append_run_output(&agent_id, "cancel", &msg.content);
                                let _ = db.finalize_latest_run(
                                    &agent_id,
                                    RunStatus::Failed,
                                    Some("Cancelled by operator".to_string()),
                                );
                                let _ = db.update_agent_status(&agent_id, &AgentStatus::Idle);
                            }
                            _ => {}
                        }
                    }
                }
            }
        });

        Ok(())
    }

    fn stop(&self, _agent_id: &str) -> Result<(), AdapterError> {
        Ok(())
    }

    fn health_check(&self, _agent_id: &str) -> Result<AdapterHealth, AdapterError> {
        Ok(AdapterHealth {
            connected: true,
            session_active: true,
            last_heartbeat: Some(chrono::Utc::now().to_rfc3339()),
            details: Some("Mock adapter (always healthy)".to_string()),
            retry_after_seconds: None,
            consecutive_failures: None,
            last_error: None,
            suppress_auto_restart: None,
        })
    }
}
