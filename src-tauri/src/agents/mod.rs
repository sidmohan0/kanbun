use crate::db::Database;
use crate::models::*;
use std::sync::Arc;

pub mod claude_code;
pub mod mock;
pub mod process;

/// The adapter trait. Each agent kind gets an implementation that translates
/// between Kanbun's message protocol and the agent's native interface.
///
/// Adapters are intentionally simple — they only need to do two things:
/// 1. Deliver outbound messages (kanbun → agent)
/// 2. Collect inbound messages (agent → kanbun)
///
/// When an agent's interface changes (new CLI flags, new API version, etc.),
/// only the adapter implementation changes. The bus, the UI, and the data
/// model are untouched.
pub trait Adapter: Send + Sync {
    /// Deliver a message to the agent. Returns Ok if the message was
    /// successfully handed off to the agent's native interface.
    fn deliver(&self, message: &Message) -> Result<(), AdapterError>;

    /// Start the adapter's background loop (monitoring agent output,
    /// heartbeats, etc.). Inbound messages should be written to the database
    /// via the provided Database handle.
    fn start(&self, agent_id: &str, db: Arc<Database>) -> Result<(), AdapterError>;

    /// Stop monitoring. Clean up resources.
    fn stop(&self, agent_id: &str) -> Result<(), AdapterError>;

    /// Check if the adapter's target is reachable/alive
    fn health_check(&self, agent_id: &str) -> Result<AdapterHealth, AdapterError>;
}

#[derive(Debug)]
pub enum AdapterError {
    NotConnected(String),
    DeliveryFailed(String),
    SessionNotFound(String),
    SpawnFailed(String),
    Other(String),
}

impl std::fmt::Display for AdapterError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotConnected(s) => write!(f, "Not connected: {}", s),
            Self::DeliveryFailed(s) => write!(f, "Delivery failed: {}", s),
            Self::SessionNotFound(s) => write!(f, "Session not found: {}", s),
            Self::SpawnFailed(s) => write!(f, "Spawn failed: {}", s),
            Self::Other(s) => write!(f, "{}", s),
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct AdapterHealth {
    pub connected: bool,
    pub session_active: bool,
    pub last_heartbeat: Option<String>,
    pub details: Option<String>,
    pub retry_after_seconds: Option<u64>,
    pub consecutive_failures: Option<u32>,
    pub last_error: Option<String>,
}

/// Create the appropriate adapter for a given config
pub fn create_adapter(config: &AdapterConfig) -> Box<dyn Adapter> {
    match config.adapter_type {
        AdapterType::ClaudeCode => Box::new(claude_code::ClaudeCodeAdapter::new(config)),
        AdapterType::Process => Box::new(process::ProcessAdapter::new(config)),
        AdapterType::Mock => Box::new(mock::MockAdapter::new()),
        // Future adapters:
        // AdapterType::Codex => Box::new(codex::CodexAdapter::new(config)),
        // AdapterType::HttpWebhook => Box::new(webhook::WebhookAdapter::new(config)),
        // AdapterType::Process => Box::new(process::ProcessAdapter::new(config)),
        _ => {
            log::warn!(
                "No adapter implemented for {:?}, falling back to mock",
                config.adapter_type
            );
            Box::new(mock::MockAdapter::new())
        }
    }
}
