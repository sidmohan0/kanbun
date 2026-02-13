use super::{Adapter, AdapterError, AdapterHealth};
use crate::db::Database;
use crate::models::*;
use std::process::Command;
use std::sync::Arc;

/// Adapter for Claude Code terminal sessions.
///
/// Strategy: Claude Code runs inside tmux sessions. This adapter:
/// - Spawns or attaches to a named tmux session
/// - Sends instructions by piping text into the tmux pane
/// - Monitors output by capturing the pane buffer periodically
/// - Detects completion/errors by watching for shell prompt patterns
///
/// This is intentionally loose coupling. When Claude Code adds a proper
/// API or changes its CLI interface, we only change this file.
///
/// # Tmux session naming convention
/// Sessions are named: `kb-{agent_id_prefix}`
/// e.g., `kb-core-01` for a Kanbun Core agent
pub struct ClaudeCodeAdapter {
    session_prefix: String,
    working_directory: Option<String>,
    claude_command: String, // "claude" by default, overridable
}

impl ClaudeCodeAdapter {
    pub fn new(config: &AdapterConfig) -> Self {
        Self {
            session_prefix: config
                .session_name
                .clone()
                .unwrap_or_else(|| "kb".to_string()),
            working_directory: config.command.clone(), // reuse command field for cwd
            claude_command: config
                .endpoint
                .clone()
                .unwrap_or_else(|| "claude".to_string()),
        }
    }

    fn session_name(&self, agent_id: &str) -> String {
        // Take first 8 chars of agent_id for a readable session name
        let short_id = &agent_id[..agent_id.len().min(8)];
        format!("{}-{}", self.session_prefix, short_id)
    }

    /// Check if a tmux session exists
    fn session_exists(&self, session: &str) -> bool {
        Command::new("tmux")
            .args(["has-session", "-t", session])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    /// Create a new tmux session with Claude Code running in it
    fn create_session(&self, session: &str) -> Result<(), AdapterError> {
        let mut cmd = Command::new("tmux");
        cmd.args(["new-session", "-d", "-s", session]);

        // Set working directory if specified
        if let Some(ref cwd) = self.working_directory {
            let expanded = shellexpand::tilde(cwd).to_string();
            cmd.args(["-c", &expanded]);
        }

        let output = cmd.output().map_err(|e| {
            AdapterError::SpawnFailed(format!("Failed to create tmux session: {}", e))
        })?;

        if !output.status.success() {
            return Err(AdapterError::SpawnFailed(
                String::from_utf8_lossy(&output.stderr).to_string(),
            ));
        }

        // Start Claude Code in the session
        self.send_to_tmux(session, &self.claude_command)?;

        // Brief pause to let Claude Code initialize
        std::thread::sleep(std::time::Duration::from_secs(2));

        Ok(())
    }

    /// Send text to a tmux session's active pane
    fn send_to_tmux(&self, session: &str, text: &str) -> Result<(), AdapterError> {
        let output = Command::new("tmux")
            .args(["send-keys", "-t", session, text, "Enter"])
            .output()
            .map_err(|e| AdapterError::DeliveryFailed(format!("tmux send-keys failed: {}", e)))?;

        if !output.status.success() {
            return Err(AdapterError::DeliveryFailed(
                String::from_utf8_lossy(&output.stderr).to_string(),
            ));
        }
        Ok(())
    }

    /// Capture the current contents of the tmux pane
    fn capture_pane(&self, session: &str, lines: usize) -> Result<String, AdapterError> {
        let output = Command::new("tmux")
            .args([
                "capture-pane",
                "-t",
                session,
                "-p", // print to stdout
                "-S",
                &format!("-{}", lines), // last N lines
            ])
            .output()
            .map_err(|e| AdapterError::Other(format!("tmux capture-pane failed: {}", e)))?;

        if !output.status.success() {
            return Err(AdapterError::Other(
                String::from_utf8_lossy(&output.stderr).to_string(),
            ));
        }

        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    }
}

impl Adapter for ClaudeCodeAdapter {
    fn deliver(&self, message: &Message) -> Result<(), AdapterError> {
        let session = self.session_name(&message.agent_id);

        // Ensure session exists
        if !self.session_exists(&session) {
            self.create_session(&session)?;
        }

        match message.kind {
            MessageKind::Instruction => {
                // Send the instruction text directly to Claude Code
                self.send_to_tmux(&session, &message.content)?;
            }
            MessageKind::Pause => {
                // Send Ctrl+C to interrupt current operation
                let _ = Command::new("tmux")
                    .args(["send-keys", "-t", &session, "C-c", ""])
                    .output();
            }
            MessageKind::Resume => {
                // Re-send the last instruction or a resume message
                self.send_to_tmux(&session, &message.content)?;
            }
            MessageKind::Cancel => {
                // Send Ctrl+C and then exit
                let _ = Command::new("tmux")
                    .args(["send-keys", "-t", &session, "C-c", ""])
                    .output();
                std::thread::sleep(std::time::Duration::from_millis(500));
                self.send_to_tmux(&session, "/exit")?;
            }
            MessageKind::StatusRequest => {
                // Capture the current pane state and report back
                // The background monitor loop handles this — this is a no-op
                // for direct delivery since we read the pane async
            }
            _ => {
                log::warn!("Unexpected message kind for delivery: {:?}", message.kind);
            }
        }

        Ok(())
    }

    fn start(&self, agent_id: &str, db: Arc<Database>) -> Result<(), AdapterError> {
        let session = self.session_name(agent_id);
        let agent_id = agent_id.to_string();

        // Ensure session exists
        if !self.session_exists(&session) {
            self.create_session(&session)?;
        }

        // Spawn a background thread that monitors the tmux pane
        let session_clone = session.clone();
        std::thread::spawn(move || {
            let mut last_output = String::new();

            loop {
                if let Ok(Some(config)) = db.get_adapter_config(&agent_id) {
                    if config.adapter_type != AdapterType::ClaudeCode {
                        log::info!(
                            "Adapter config switched for {}; stopping Claude monitor",
                            agent_id
                        );
                        break;
                    }
                }

                std::thread::sleep(std::time::Duration::from_secs(3));

                // Check if session still exists
                let exists = Command::new("tmux")
                    .args(["has-session", "-t", &session_clone])
                    .output()
                    .map(|o| o.status.success())
                    .unwrap_or(false);

                if !exists {
                    log::info!("Session {} ended, stopping monitor", session_clone);
                    let msg =
                        Message::from_agent(&agent_id, MessageKind::Completed, "Session ended");
                    let _ = db.insert_message(&msg);
                    let _ = db.append_run_output(&agent_id, "completed", &msg.content);
                    let _ = db.finalize_latest_run(
                        &agent_id,
                        RunStatus::Completed,
                        Some(msg.content.clone()),
                    );
                    let _ = db.update_agent_status(&agent_id, &AgentStatus::Completed);
                    break;
                }

                // Capture pane output
                let output = Command::new("tmux")
                    .args(["capture-pane", "-t", &session_clone, "-p", "-S", "-50"])
                    .output();

                if let Ok(output) = output {
                    let current = String::from_utf8_lossy(&output.stdout).to_string();

                    // Only report if output changed (new activity)
                    if current != last_output && !current.trim().is_empty() {
                        // Extract just the new lines
                        let new_content = if !last_output.is_empty() {
                            current
                                .lines()
                                .filter(|line| !last_output.contains(line))
                                .collect::<Vec<_>>()
                                .join("\n")
                        } else {
                            current.clone()
                        };

                        if !new_content.trim().is_empty() {
                            // Send heartbeat with recent output
                            let msg = Message::from_agent(
                                &agent_id,
                                MessageKind::Heartbeat,
                                &new_content,
                            );
                            let _ = db.insert_message(&msg);
                            let _ = db.append_run_output(&agent_id, "heartbeat", &msg.content);
                            let _ = db.update_agent_status(&agent_id, &AgentStatus::Running);
                        }

                        last_output = current;
                    }
                }

                // Check for pending messages to deliver
                if let Ok(pending) = db.get_pending_messages(&agent_id) {
                    for msg in pending {
                        match msg.kind {
                            MessageKind::Instruction => {
                                let _ = db.start_instruction_run(&agent_id, &msg.content);
                                let _ = Command::new("tmux")
                                    .args([
                                        "send-keys",
                                        "-t",
                                        &session_clone,
                                        &msg.content,
                                        "Enter",
                                    ])
                                    .output();
                                let _ = db.update_agent_status(&agent_id, &AgentStatus::Running);
                            }
                            MessageKind::Pause => {
                                let _ = Command::new("tmux")
                                    .args(["send-keys", "-t", &session_clone, "C-c", ""])
                                    .output();
                                let _ = db.append_run_output(&agent_id, "pause", &msg.content);
                                let _ = db.update_agent_status(&agent_id, &AgentStatus::Blocked);
                            }
                            MessageKind::Resume => {
                                let _ = db.start_instruction_run(&agent_id, &msg.content);
                                let _ = Command::new("tmux")
                                    .args([
                                        "send-keys",
                                        "-t",
                                        &session_clone,
                                        &msg.content,
                                        "Enter",
                                    ])
                                    .output();
                                let _ = db.update_agent_status(&agent_id, &AgentStatus::Running);
                            }
                            MessageKind::Cancel => {
                                let _ = Command::new("tmux")
                                    .args(["send-keys", "-t", &session_clone, "C-c", ""])
                                    .output();
                                std::thread::sleep(std::time::Duration::from_millis(500));
                                let _ = Command::new("tmux")
                                    .args(["send-keys", "-t", &session_clone, "/exit", "Enter"])
                                    .output();
                                let _ = db.append_run_output(&agent_id, "cancel", &msg.content);
                                let _ = db.finalize_latest_run(
                                    &agent_id,
                                    RunStatus::Failed,
                                    Some("Cancelled by operator".to_string()),
                                );
                                let _ = db.update_agent_status(&agent_id, &AgentStatus::Idle);
                            }
                            MessageKind::StatusRequest => {
                                let status = Command::new("tmux")
                                    .args(["capture-pane", "-t", &session_clone, "-p", "-S", "-20"])
                                    .output()
                                    .ok()
                                    .map(|out| String::from_utf8_lossy(&out.stdout).to_string())
                                    .unwrap_or_else(|| "Unable to capture tmux output".to_string());
                                let message = Message::from_agent(
                                    &agent_id,
                                    MessageKind::StatusUpdate,
                                    status.trim(),
                                );
                                let _ = db.insert_message(&message);
                                let _ = db.append_run_output(
                                    &agent_id,
                                    "status_update",
                                    &message.content,
                                );
                            }
                            _ => {}
                        }
                        let _ = db.mark_delivered(&msg.id);
                    }
                }
            }
        });

        Ok(())
    }

    fn stop(&self, agent_id: &str) -> Result<(), AdapterError> {
        let session = self.session_name(agent_id);
        if self.session_exists(&session) {
            let _ = Command::new("tmux")
                .args(["kill-session", "-t", &session])
                .output();
        }
        Ok(())
    }

    fn health_check(&self, agent_id: &str) -> Result<AdapterHealth, AdapterError> {
        let session = self.session_name(agent_id);
        let active = self.session_exists(&session);

        let details = if active {
            self.capture_pane(&session, 5).ok()
        } else {
            None
        };

        Ok(AdapterHealth {
            connected: active,
            session_active: active,
            last_heartbeat: None, // filled by the monitor loop
            details,
        })
    }
}
