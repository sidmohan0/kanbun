import { invoke } from "@tauri-apps/api/core";
import type {
  DashboardView,
  AgentDetail,
  Project,
  ProjectContextDocument,
  Agent,
  AgentKind,
  AgentStatus,
  Message,
  MessageKind,
  ConversationThread,
  AdapterConfig,
  AdapterHealth,
  ConnectorInfo,
  ConnectorConfig,
  ConnectorItem,
  SyncResult,
} from "@/types";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && typeof window.__TAURI_INTERNALS__ !== "undefined";
}

export async function getDashboard(): Promise<DashboardView> {
  return invoke("get_dashboard");
}

export async function getAgentDetail(agentId: string): Promise<AgentDetail> {
  return invoke("get_agent_detail", { agentId });
}

export async function createProject(
  name: string,
  color: string
): Promise<Project> {
  return invoke("create_project", { name, color });
}

export async function listProjectContextDocs(projectId: string): Promise<ProjectContextDocument[]> {
  return invoke("list_project_context_docs", { projectId });
}

export async function saveProjectContextDoc(
  projectId: string,
  title: string,
  content: string,
  docId?: string
): Promise<ProjectContextDocument> {
  return invoke("save_project_context_doc", { projectId, docId, title, content });
}

export async function deleteProjectContextDoc(docId: string): Promise<void> {
  return invoke("delete_project_context_doc", { docId });
}

export async function createAgent(params: {
  name: string;
  projectId: string;
  kind: AgentKind;
  functionTag: string;
  workingDirectory?: string;
}): Promise<Agent> {
  return invoke("create_agent", params);
}

export async function updateAgentStatus(
  agentId: string,
  status: AgentStatus
): Promise<void> {
  return invoke("update_agent_status", { agentId, status });
}

// ── Message Bus ─────────────────────────────────────────────────────────────

export async function sendMessage(
  agentId: string,
  kind: MessageKind,
  content: string,
  replyTo?: string
): Promise<Message> {
  return invoke("send_message", { agentId, kind, content, replyTo });
}

export async function getConversation(
  agentId: string,
  limit?: number
): Promise<ConversationThread> {
  return invoke("get_conversation", { agentId, limit });
}

export async function receiveMessage(
  agentId: string,
  kind: MessageKind,
  content: string,
  metadata?: Record<string, unknown>,
  replyTo?: string
): Promise<Message> {
  return invoke("receive_message", { agentId, kind, content, metadata, replyTo });
}

export async function setAdapterConfig(
  agentId: string,
  config: AdapterConfig
): Promise<void> {
  return invoke("set_adapter_config", { agentId, config });
}

export async function getAdapterHealth(agentId: string): Promise<AdapterHealth | null> {
  return invoke("get_adapter_health", { agentId });
}

export async function restartAdapter(agentId: string): Promise<AdapterHealth | null> {
  return invoke("restart_adapter", { agentId });
}

// ── Connectors ──────────────────────────────────────────────────────────────

export async function listConnectors(): Promise<ConnectorInfo[]> {
  return invoke("list_connectors");
}

export async function saveConnector(config: ConnectorConfig): Promise<void> {
  return invoke("save_connector", { config });
}

export async function getConnectorConfigs(): Promise<ConnectorConfig[]> {
  return invoke("get_connector_configs");
}

export async function syncConnector(connectorType: string): Promise<SyncResult> {
  return invoke("sync_connector", { connectorType });
}

export async function getConnectorItems(connectorType: string): Promise<ConnectorItem[]> {
  return invoke("get_connector_items", { connectorType });
}

export async function pushConnectorItem(
  connectorType: string,
  item: ConnectorItem
): Promise<ConnectorItem> {
  return invoke("push_connector_item", { connectorType, item });
}

export async function deleteConnectorItem(
  connectorType: string,
  itemId: string
): Promise<void> {
  return invoke("delete_connector_item", { connectorType, itemId });
}
