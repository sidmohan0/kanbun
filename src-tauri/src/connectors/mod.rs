use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub mod obsidian;
pub mod todoist;

// ── Core types ──────────────────────────────────────────────────────────────

/// A normalized item from any external service. Todoist tasks, Notion pages,
/// Obsidian notes, Linear issues — they all reduce to this shape.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectorItem {
    pub id: String,     // external ID (Todoist task ID, Notion page ID, etc.)
    pub source: String, // "todoist", "notion", "obsidian"
    pub title: String,
    pub content: Option<String>, // body text, description, note content
    pub status: ItemStatus,
    pub priority: Option<u8>,              // 1-4, normalized across services
    pub tags: Vec<String>,                 // labels, tags, categories
    pub url: Option<String>,               // deep link back to the source
    pub parent_id: Option<String>,         // for hierarchical items (subtasks, sub-pages)
    pub metadata: HashMap<String, String>, // service-specific fields
    pub created_at: Option<DateTime<Utc>>,
    pub updated_at: Option<DateTime<Utc>>,
    pub due_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ItemStatus {
    Active,
    Completed,
    Archived,
    InProgress,
}

/// What a connector can do — declared upfront so the UI knows what to render
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectorCapabilities {
    pub can_read: bool,
    pub can_write: bool,
    pub can_delete: bool,
    pub can_search: bool,
    pub supports_hierarchy: bool, // subtasks, sub-pages
    pub supports_due_dates: bool,
    pub supports_priorities: bool,
    pub supports_tags: bool,
}

/// Metadata about a connector for the UI
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectorInfo {
    pub id: String,   // "todoist", "notion", "obsidian"
    pub name: String, // "Todoist"
    pub icon: String, // emoji or icon name
    pub capabilities: ConnectorCapabilities,
    pub auth_type: AuthType,
    pub status: ConnectorStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum AuthType {
    ApiKey, // bearer token / API key
    OAuth,  // OAuth2 flow
    Local,  // no auth needed (local files)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ConnectorStatus {
    Connected,
    Disconnected,
    Error,
    NeedsAuth,
}

/// Result of a sync operation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncResult {
    pub connector_id: String,
    pub pulled: usize,
    pub pushed: usize,
    pub errors: Vec<String>,
    pub synced_at: DateTime<Utc>,
}

// ── Connector trait ─────────────────────────────────────────────────────────

/// The connector contract. External data sources implement this to expose
/// their data in a normalized format. Unlike adapters (which are conversational
/// and bidirectional), connectors are CRUD-oriented: read state, write state.
///
/// Design principle: connectors are *thin*. They translate between the
/// service's native API and ConnectorItem. Business logic (filtering,
/// deduplication, display) happens in the layers above.
#[async_trait]
pub trait Connector: Send + Sync {
    /// Connector metadata for the UI
    fn info(&self) -> ConnectorInfo;

    /// Pull items from the service. Accepts optional filters.
    async fn pull(&self, filter: Option<PullFilter>) -> Result<Vec<ConnectorItem>, ConnectorError>;

    /// Push a new item to the service
    async fn push(&self, item: &ConnectorItem) -> Result<ConnectorItem, ConnectorError>;

    /// Update an existing item
    async fn update(&self, item: &ConnectorItem) -> Result<ConnectorItem, ConnectorError>;

    /// Delete an item by its external ID
    async fn delete(&self, external_id: &str) -> Result<(), ConnectorError>;

    /// Test connectivity (API key valid, files accessible, etc.)
    async fn health_check(&self) -> Result<ConnectorStatus, ConnectorError>;
}

/// Filters for pull operations
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PullFilter {
    pub status: Option<ItemStatus>,
    pub tags: Option<Vec<String>>,
    pub since: Option<DateTime<Utc>>,
    pub search: Option<String>,
    pub limit: Option<usize>,
}

// ── Errors ──────────────────────────────────────────────────────────────────

#[derive(Debug)]
pub enum ConnectorError {
    AuthFailed(String),
    NotFound(String),
    RateLimited(String),
    NetworkError(String),
    ParseError(String),
    FileSystemError(String),
    NotSupported(String),
    Other(String),
}

impl std::fmt::Display for ConnectorError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::AuthFailed(s) => write!(f, "Auth failed: {}", s),
            Self::NotFound(s) => write!(f, "Not found: {}", s),
            Self::RateLimited(s) => write!(f, "Rate limited: {}", s),
            Self::NetworkError(s) => write!(f, "Network error: {}", s),
            Self::ParseError(s) => write!(f, "Parse error: {}", s),
            Self::FileSystemError(s) => write!(f, "File system error: {}", s),
            Self::NotSupported(s) => write!(f, "Not supported: {}", s),
            Self::Other(s) => write!(f, "{}", s),
        }
    }
}

impl From<ConnectorError> for String {
    fn from(e: ConnectorError) -> Self {
        e.to_string()
    }
}

// ── Registry ────────────────────────────────────────────────────────────────

/// Stored connector configuration (persisted in SQLite)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectorConfig {
    pub connector_type: String,            // "todoist", "notion", "obsidian"
    pub auth_token: Option<String>,        // API key / OAuth token
    pub settings: HashMap<String, String>, // connector-specific settings
    pub enabled: bool,
}

/// Create a connector instance from stored config
pub fn create_connector(config: &ConnectorConfig) -> Result<Box<dyn Connector>, ConnectorError> {
    match config.connector_type.as_str() {
        "todoist" => {
            let token = config
                .auth_token
                .clone()
                .ok_or_else(|| ConnectorError::AuthFailed("Todoist API token required".into()))?;
            Ok(Box::new(todoist::TodoistConnector::new(token)))
        }
        "obsidian" => {
            let vault_path = config
                .settings
                .get("vault_path")
                .ok_or_else(|| ConnectorError::Other("Obsidian vault path required".into()))?;
            Ok(Box::new(obsidian::ObsidianConnector::new(vault_path)))
        }
        // Future:
        // "notion" => { ... }
        // "linear" => { ... }
        // "github_issues" => { ... }
        other => Err(ConnectorError::NotSupported(format!(
            "Unknown connector: {}",
            other
        ))),
    }
}
