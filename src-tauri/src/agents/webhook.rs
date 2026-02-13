use super::{Adapter, AdapterError, AdapterHealth};
use crate::db::Database;
use crate::models::*;
use chrono::Utc;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;
use std::thread;
use std::time::Duration;

const AUTH_HEADER_KEY: &str = "AUTH_HEADER";
const DEFAULT_WEBHOOK_ENDPOINT: &str = "http://localhost:8765/kanbun/webhook";
const REQUEST_TIMEOUT_SECONDS: u64 = 8;
const POLL_INTERVAL_MS: u64 = 700;

#[derive(Debug, Serialize)]
struct WebhookRequest<'a> {
    agent_id: &'a str,
    message_id: &'a str,
    kind: &'a str,
    content: &'a str,
    reply_to: Option<&'a str>,
    metadata: Option<&'a Value>,
}

#[derive(Debug, Deserialize)]
struct WebhookResponse {
    #[serde(default)]
    kind: Option<String>,
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    content: Option<String>,
}

#[derive(Debug)]
pub struct WebhookAdapter {
    endpoint: String,
    auth_header: Option<String>,
}

impl WebhookAdapter {
    pub fn new(config: &AdapterConfig) -> Self {
        Self {
            endpoint: config
                .endpoint
                .clone()
                .unwrap_or_else(|| DEFAULT_WEBHOOK_ENDPOINT.to_string()),
            auth_header: config
                .env
                .as_ref()
                .and_then(|env| env.get(AUTH_HEADER_KEY))
                .and_then(Value::as_str)
                .map(|value| value.to_string()),
        }
    }

    fn build_client() -> Client {
        Client::builder()
            .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECONDS))
            .build()
            .unwrap_or_else(|_| Client::new())
    }

    fn endpoint_url(&self) -> &str {
        &self.endpoint
    }

    fn message_type_from_reply(raw: &str) -> MessageKind {
        match raw {
            "output" => MessageKind::Output,
            "error" => MessageKind::Error,
            "blocked" => MessageKind::Blocked,
            "completed" => MessageKind::Completed,
            "status_update" => MessageKind::StatusUpdate,
            "heartbeat" => MessageKind::Heartbeat,
            "pause" => MessageKind::Pause,
            "cancel" => MessageKind::Cancel,
            "resume" => MessageKind::Resume,
            "status_request" => MessageKind::StatusRequest,
            "status" => MessageKind::StatusUpdate,
            _ => MessageKind::Output,
        }
    }

    fn message_kind_as_output(kind: MessageKind) -> &'static str {
        match kind {
            MessageKind::Output => "output",
            MessageKind::Error => "error",
            MessageKind::Blocked => "blocked",
            MessageKind::Completed => "completed",
            MessageKind::StatusUpdate => "status_update",
            MessageKind::Heartbeat => "heartbeat",
            MessageKind::Pause => "pause",
            MessageKind::Resume => "resume",
            MessageKind::Cancel => "cancel",
            MessageKind::StatusRequest => "status_request",
            MessageKind::Instruction => "instruction",
        }
    }

    fn message_kind_for_transport(kind: MessageKind) -> &'static str {
        match kind {
            MessageKind::Instruction => "instruction",
            MessageKind::Pause => "pause",
            MessageKind::Resume => "resume",
            MessageKind::Cancel => "cancel",
            MessageKind::StatusRequest => "status_request",
            MessageKind::StatusUpdate => "status_update",
            MessageKind::Output => "output",
            MessageKind::Error => "error",
            MessageKind::Blocked => "blocked",
            MessageKind::Completed => "completed",
            MessageKind::Heartbeat => "heartbeat",
        }
    }

    fn normalize_status(raw: &str) -> Option<RunStatus> {
        match raw {
            "completed" => Some(RunStatus::Completed),
            "failed" => Some(RunStatus::Failed),
            "needs_review" => Some(RunStatus::NeedsReview),
            _ => None,
        }
    }

    fn post_payload(
        &self,
        agent_id: &str,
        message: &Message,
    ) -> Result<Option<WebhookResponse>, AdapterError> {
        let endpoint = self.endpoint_url().to_string();
        let client = Self::build_client();
        let payload = WebhookRequest {
            agent_id,
            message_id: &message.id,
            kind: Self::message_kind_for_transport(message.kind.clone()),
            content: &message.content,
            reply_to: message.reply_to.as_deref(),
            metadata: message.metadata.as_ref(),
        };

        let runtime = tokio::runtime::Runtime::new().map_err(|error| {
            AdapterError::DeliveryFailed(format!("failed to initialize webhook runtime: {error}"))
        })?;

        runtime.block_on(async move {
            let mut request = client.post(&endpoint).json(&payload);
            if let Some(auth) = &self.auth_header {
                request = request.header("Authorization", auth);
            }

            let response = request.send().await;
            match response {
                Ok(response) => {
                    if !response.status().is_success() {
                        return Err(AdapterError::Other(format!(
                            "webhook endpoint returned HTTP {}",
                            response.status()
                        )));
                    }
                    match response.json::<WebhookResponse>().await {
                        Ok(reply) => Ok(Some(reply)),
                        Err(_) => Ok(None),
                    }
                }
                Err(error) => Err(AdapterError::Other(format!(
                    "failed to post to webhook endpoint {endpoint}: {error}"
                ))),
            }
        })
    }
}

impl Adapter for WebhookAdapter {
    fn deliver(&self, message: &Message) -> Result<(), AdapterError> {
        match message.kind {
            MessageKind::Instruction
            | MessageKind::Resume
            | MessageKind::StatusRequest
            | MessageKind::Pause
            | MessageKind::Cancel => {
                let _ = self.post_payload(&message.agent_id, message)?;
            }
            _ => {}
        }
        Ok(())
    }

    fn start(&self, agent_id: &str, db: Arc<Database>) -> Result<(), AdapterError> {
        let agent_id = agent_id.to_string();

        thread::spawn(move || loop {
            let config = match db.get_adapter_config(&agent_id) {
                Ok(Some(config)) if config.adapter_type == AdapterType::HttpWebhook => config,
                Ok(_) => break,
                Err(_) => break,
            };
            let adapter = WebhookAdapter::new(&config);

            if let Ok(pending) = db.get_pending_messages(&agent_id) {
                for message in pending {
                    let maybe_response = adapter.post_payload(&agent_id, &message);

                    match message.kind {
                        MessageKind::Instruction | MessageKind::Resume => {
                            let _ = db.start_instruction_run(&agent_id, &message.content);
                            let _ = db.update_agent_status(&agent_id, &AgentStatus::Running);
                        }
                        MessageKind::Pause => {
                            let _ = db.update_agent_status(&agent_id, &AgentStatus::Blocked);
                        }
                        MessageKind::Cancel => {
                            let _ = db.finalize_latest_run(
                                &agent_id,
                                RunStatus::Failed,
                                Some("Cancelled by operator".to_string()),
                            );
                            let _ = db.update_agent_status(&agent_id, &AgentStatus::Idle);
                        }
                        _ => {}
                    }

                    match maybe_response {
                        Ok(Some(reply)) => {
                            let mapped = reply
                                .kind
                                .as_deref()
                                .or(reply.status.as_deref())
                                .map(Self::message_type_from_reply)
                                .unwrap_or(MessageKind::Output);
                            let mapped_kind = mapped.clone();
                            let content = reply.content.unwrap_or_else(|| {
                                "Webhook adapter completed with no response.".to_string()
                            });
                            let inbound = Message::from_agent(&agent_id, mapped_kind, &content);
                            let _ = db.insert_message(&inbound);
                            let _ = db.append_run_output(
                                &agent_id,
                                Self::message_kind_as_output(mapped.clone()),
                                &content,
                            );

                            if let Some(run_status) = reply
                                .status
                                .and_then(|status| Self::normalize_status(&status))
                            {
                                let _ = db.finalize_latest_run(
                                    &agent_id,
                                    run_status.clone(),
                                    Some(content.clone()),
                                );
                                let _ = match run_status {
                                    RunStatus::Completed => {
                                        db.update_agent_status(&agent_id, &AgentStatus::Completed)
                                    }
                                    RunStatus::Failed => {
                                        db.update_agent_status(&agent_id, &AgentStatus::Errored)
                                    }
                                    RunStatus::NeedsReview => {
                                        db.update_agent_status(&agent_id, &AgentStatus::Blocked)
                                    }
                                    RunStatus::InProgress => Ok(()),
                                };
                            } else {
                                let _ = db.update_agent_status(&agent_id, &AgentStatus::Running);
                            }
                        }
                        Ok(None) => {
                            let _ = db.update_agent_status(&agent_id, &AgentStatus::Running);
                        }
                        Err(error) => {
                            let text = format!("Webhook delivery failed: {error}");
                            let failure = Message::from_agent(&agent_id, MessageKind::Error, &text);
                            let _ = db.insert_message(&failure);
                            let _ = db.append_run_output(&agent_id, "error", &text);
                            let _ =
                                db.finalize_latest_run(&agent_id, RunStatus::Failed, Some(text));
                            let _ = db.update_agent_status(&agent_id, &AgentStatus::Errored);
                        }
                    }

                    let _ = db.mark_delivered(&message.id);
                }
            }

            thread::sleep(Duration::from_millis(POLL_INTERVAL_MS));
        });

        Ok(())
    }

    fn stop(&self, _agent_id: &str) -> Result<(), AdapterError> {
        Ok(())
    }

    fn health_check(&self, _agent_id: &str) -> Result<AdapterHealth, AdapterError> {
        let runtime = tokio::runtime::Runtime::new().map_err(|error| {
            AdapterError::Other(format!(
                "failed to initialize webhook health runtime: {error}"
            ))
        })?;

        let endpoint = self.endpoint_url().to_string();
        let client = Self::build_client();

        let reachable = runtime.block_on(async {
            match client.get(&endpoint).send().await {
                Ok(response) => response.status().is_success(),
                Err(_) => false,
            }
        });

        if reachable {
            Ok(AdapterHealth {
                connected: true,
                session_active: true,
                last_heartbeat: Some(Utc::now().to_rfc3339()),
                details: Some(format!("Webhook endpoint reachable: {endpoint}")),
                retry_after_seconds: None,
                consecutive_failures: None,
                last_error: None,
                suppress_auto_restart: None,
            })
        } else {
            Ok(AdapterHealth {
                connected: false,
                session_active: false,
                last_heartbeat: None,
                details: Some(format!("Webhook endpoint unreachable: {endpoint}")),
                retry_after_seconds: None,
                consecutive_failures: None,
                last_error: Some("webhook health check failed".to_string()),
                suppress_auto_restart: None,
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn map_reply_kind_defaults_to_output() {
        let kind = WebhookAdapter::message_type_from_reply("output");
        assert_eq!(kind, MessageKind::Output);
        let unknown = WebhookAdapter::message_type_from_reply("not-a-kind");
        assert_eq!(unknown, MessageKind::Output);
    }
}
