use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ── Projects ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub color: String,           // hex color for UI grouping
    pub repo_paths: Vec<String>, // local directories to watch
    pub created_at: DateTime<Utc>,
}

impl Project {
    pub fn new(name: &str, color: &str) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            name: name.to_string(),
            color: color.to_string(),
            repo_paths: vec![],
            created_at: Utc::now(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectContextDocument {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub content: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl ProjectContextDocument {
    pub fn new(project_id: &str, title: &str, content: &str) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4().to_string(),
            project_id: project_id.to_string(),
            title: title.to_string(),
            content: content.to_string(),
            created_at: now,
            updated_at: now,
        }
    }
}

// ── Agents ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum AgentKind {
    Terminal, // Claude Code, Codex, etc.
    Api,      // API-based agents that POST status
    Script,   // Cron-like scripts, MCP agents
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum AgentStatus {
    Idle,
    Running,
    Blocked,
    Errored,
    Completed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Agent {
    pub id: String,
    pub name: String,
    pub project_id: String,
    pub kind: AgentKind,
    pub function_tag: String, // "marketing", "sdk", "landing_page", etc.
    pub status: AgentStatus,
    pub working_directory: Option<String>,
    pub last_active_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub config: AgentConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentConfig {
    pub autonomy_level: AutonomyLevel,
    pub watch_paths: Vec<String>, // specific paths this agent works in
    pub schedule: Option<String>, // cron expression if scheduled
    pub notify_on: Vec<AgentStatus>, // when to alert
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AutonomyLevel {
    Manual,     // agent does nothing without approval
    DraftOnly,  // agent produces output, waits for review
    Supervised, // agent executes, flags for post-review
    Autonomous, // agent runs freely, reports results
}

impl Agent {
    pub fn new(name: &str, project_id: &str, kind: AgentKind, function_tag: &str) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            name: name.to_string(),
            project_id: project_id.to_string(),
            kind,
            function_tag: function_tag.to_string(),
            status: AgentStatus::Idle,
            working_directory: None,
            last_active_at: None,
            created_at: Utc::now(),
            config: AgentConfig {
                autonomy_level: AutonomyLevel::Supervised,
                watch_paths: vec![],
                schedule: None,
                notify_on: vec![AgentStatus::Errored, AgentStatus::Blocked],
            },
        }
    }
}

// ── Runs ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Run {
    pub id: String,
    pub agent_id: String,
    pub status: RunStatus,
    pub started_at: DateTime<Utc>,
    pub ended_at: Option<DateTime<Utc>>,
    pub summary: Option<String>,
    pub outputs: Vec<RunOutput>,
    pub file_changes: Vec<FileChange>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum RunStatus {
    InProgress,
    Completed,
    Failed,
    NeedsReview,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunOutput {
    pub kind: String, // "message", "file", "pr", "email_draft", etc.
    pub content: String,
    pub timestamp: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileChange {
    pub path: String,
    pub change_type: FileChangeType,
    pub timestamp: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FileChangeType {
    Created,
    Modified,
    Deleted,
    Renamed,
}

// ── Message Protocol ────────────────────────────────────────────────────────
// This is the stable contract. Agents don't talk to Kanbun directly —
// they speak this protocol through thin adapters. When agent interfaces change,
// only the adapter changes. The bus, the UI, and the data model stay the same.

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub id: String,
    pub agent_id: String,
    pub direction: MessageDirection,
    pub kind: MessageKind,
    pub content: String,
    pub metadata: Option<serde_json::Value>, // adapter-specific data (exit codes, file lists, etc.)
    pub reply_to: Option<String>,            // thread messages to a parent
    pub created_at: DateTime<Utc>,
    pub delivered_at: Option<DateTime<Utc>>, // None = still in queue
    pub acknowledged_at: Option<DateTime<Utc>>, // adapter confirmed receipt
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum MessageDirection {
    ToAgent,   // kanbun → agent (instructions)
    FromAgent, // agent → kanbun (responses, status updates)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum MessageKind {
    // ToAgent kinds
    Instruction,   // "commit what you have and open a PR"
    Pause,         // pause execution
    Resume,        // resume execution
    Cancel,        // kill the current task
    StatusRequest, // "what are you doing right now?"

    // FromAgent kinds
    StatusUpdate, // agent reporting current state
    Output,       // work product (code, text, file paths, etc.)
    Error,        // something went wrong
    Blocked,      // agent needs human input to continue
    Completed,    // task finished
    Heartbeat,    // alive ping (adapters send these periodically)
}

impl Message {
    /// Create a new outbound message (kanbun → agent)
    pub fn to_agent(agent_id: &str, kind: MessageKind, content: &str) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            agent_id: agent_id.to_string(),
            direction: MessageDirection::ToAgent,
            kind,
            content: content.to_string(),
            metadata: None,
            reply_to: None,
            created_at: Utc::now(),
            delivered_at: None,
            acknowledged_at: None,
        }
    }

    /// Create a new inbound message (agent → kanbun)
    pub fn from_agent(agent_id: &str, kind: MessageKind, content: &str) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            agent_id: agent_id.to_string(),
            direction: MessageDirection::FromAgent,
            kind,
            content: content.to_string(),
            metadata: None,
            reply_to: None,
            created_at: Utc::now(),
            delivered_at: Some(Utc::now()),
            acknowledged_at: None,
        }
    }
}

// ── Adapter Registry ────────────────────────────────────────────────────────
// Each agent kind has an adapter that translates between the message protocol
// and the native agent interface. This config tells the adapter how to connect.

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdapterConfig {
    pub adapter_type: AdapterType,
    pub session_name: Option<String>, // tmux/screen session name for terminal agents
    pub endpoint: Option<String>,     // URL for API agents
    pub command: Option<String>,      // spawn command for script agents
    pub env: Option<serde_json::Value>, // environment variables
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum AdapterType {
    ClaudeCode,  // Claude Code CLI sessions
    Codex,       // OpenAI Codex CLI
    Tmux,        // Generic tmux session monitoring
    HttpWebhook, // API agents that accept/send webhooks
    Process,     // Spawn and manage a child process
    Mock,        // For testing — echoes messages back
}

// ── Conversation Thread ─────────────────────────────────────────────────────
// A flattened view of the message exchange with an agent, for the UI

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationThread {
    pub agent_id: String,
    pub messages: Vec<Message>,
    pub has_more: bool,
}

// ── Dashboard DTOs ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashboardView {
    pub projects: Vec<ProjectWithAgents>,
    pub needs_attention: Vec<AttentionItem>,
    pub stats: DashboardStats,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectWithAgents {
    pub project: Project,
    pub agents: Vec<AgentSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentSummary {
    pub agent: Agent,
    pub recent_run: Option<Run>,
    pub files_changed_today: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttentionItem {
    pub agent_id: String,
    pub agent_name: String,
    pub project_name: String,
    pub reason: String, // "errored", "needs_review", "blocked"
    pub timestamp: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DashboardStats {
    pub total_agents: usize,
    pub running: usize,
    pub idle: usize,
    pub errored: usize,
    pub needs_attention: usize,
    pub files_changed_today: usize,
}
