// ── Projects ────────────────────────────────────────────────────────────────

export interface Project {
  id: string;
  name: string;
  color: string;
  repo_paths: string[];
  created_at: string;
}

export interface ProjectContextDocument {
  id: string;
  project_id: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
}

// ── Agents ──────────────────────────────────────────────────────────────────

export type AgentKind = "terminal" | "api" | "script";
export type AgentStatus = "idle" | "running" | "blocked" | "errored" | "completed";

export type AutonomyLevel = "manual" | "draft_only" | "supervised" | "autonomous";

export interface AgentConfig {
  autonomy_level: AutonomyLevel;
  watch_paths: string[];
  schedule: string | null;
  notify_on: AgentStatus[];
}

export interface Agent {
  id: string;
  name: string;
  project_id: string;
  kind: AgentKind;
  function_tag: string;
  status: AgentStatus;
  working_directory: string | null;
  last_active_at: string | null;
  created_at: string;
  config: AgentConfig;
}

// ── Runs ────────────────────────────────────────────────────────────────────

export type RunStatus = "in_progress" | "completed" | "failed" | "needs_review";

export interface RunOutput {
  kind: string;
  content: string;
  timestamp: string;
}

export type FileChangeType = "created" | "modified" | "deleted" | "renamed";

export interface FileChange {
  path: string;
  change_type: FileChangeType;
  timestamp: string;
}

export interface Run {
  id: string;
  agent_id: string;
  status: RunStatus;
  started_at: string;
  ended_at: string | null;
  summary: string | null;
  outputs: RunOutput[];
  file_changes: FileChange[];
}

// ── Dashboard DTOs ──────────────────────────────────────────────────────────

export interface DashboardView {
  projects: ProjectWithAgents[];
  needs_attention: AttentionItem[];
  stats: DashboardStats;
}

export interface ProjectWithAgents {
  project: Project;
  agents: AgentSummary[];
}

export interface AgentSummary {
  agent: Agent;
  recent_run: Run | null;
  files_changed_today: number;
}

export interface AttentionItem {
  agent_id: string;
  agent_name: string;
  project_name: string;
  reason: string;
  timestamp: string;
}

export interface DashboardStats {
  total_agents: number;
  running: number;
  idle: number;
  errored: number;
  needs_attention: number;
  files_changed_today: number;
}

export interface AgentDetail {
  agent: Agent;
  runs: Run[];
  messages: Message[];
  adapter_config: AdapterConfig | null;
}

// ── Message Protocol ────────────────────────────────────────────────────────

export type MessageDirection = "to_agent" | "from_agent";

export type MessageKind =
  | "instruction"
  | "pause"
  | "resume"
  | "cancel"
  | "status_request"
  | "status_update"
  | "output"
  | "error"
  | "blocked"
  | "completed"
  | "heartbeat";

export interface Message {
  id: string;
  agent_id: string;
  direction: MessageDirection;
  kind: MessageKind;
  content: string;
  metadata: Record<string, unknown> | null;
  reply_to: string | null;
  created_at: string;
  delivered_at: string | null;
  acknowledged_at: string | null;
}

export interface ConversationThread {
  agent_id: string;
  messages: Message[];
  has_more: boolean;
}

// ── Adapter ─────────────────────────────────────────────────────────────────

export type AdapterType =
  | "claude_code"
  | "codex"
  | "tmux"
  | "http_webhook"
  | "process"
  | "mock";

export interface AdapterConfig {
  adapter_type: AdapterType;
  session_name: string | null;
  endpoint: string | null;
  command: string | null;
  env: Record<string, string> | null;
}

export interface AdapterHealth {
  connected: boolean;
  session_active: boolean;
  last_heartbeat: string | null;
  details: string | null;
}

// ── Connectors ──────────────────────────────────────────────────────────────

export type ConnectorType = "todoist" | "notion" | "obsidian" | "linear" | "github_issues";

export type ItemStatus = "active" | "completed" | "archived" | "in_progress";

export type AuthType = "api_key" | "oauth" | "local";

export type ConnectorStatus = "connected" | "disconnected" | "error" | "needs_auth";

export interface ConnectorItem {
  id: string;
  source: string;
  title: string;
  content: string | null;
  status: ItemStatus;
  priority: number | null;
  tags: string[];
  url: string | null;
  parent_id: string | null;
  metadata: Record<string, string>;
  created_at: string | null;
  updated_at: string | null;
  due_at: string | null;
}

export interface ConnectorInfo {
  id: string;
  name: string;
  icon: string;
  capabilities: ConnectorCapabilities;
  auth_type: AuthType;
  status: ConnectorStatus;
}

export interface ConnectorCapabilities {
  can_read: boolean;
  can_write: boolean;
  can_delete: boolean;
  can_search: boolean;
  supports_hierarchy: boolean;
  supports_due_dates: boolean;
  supports_priorities: boolean;
  supports_tags: boolean;
}

export interface ConnectorConfig {
  connector_type: string;
  auth_token: string | null;
  settings: Record<string, string>;
  enabled: boolean;
}

export interface SyncResult {
  connector_id: string;
  pulled: number;
  pushed: number;
  errors: string[];
  synced_at: string;
}
