"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import type {
  AdapterConfig,
  AdapterHealth,
  AdapterType,
  AgentDetail,
  AgentKind,
  DatabaseSnapshotResult,
  ConnectorConfig,
  ConnectorInfo,
  ConnectorItem,
  DashboardView,
  Message,
  MessageKind,
  ProjectContextDocument,
} from "@/types";
import {
  createAgent,
  deleteProjectContextDoc,
  createProject,
  deleteConnectorItem,
  exportDatabaseSnapshot,
  getAdapterHealth,
  getAgentDetail,
  getConnectorConfigs,
  getConnectorItems,
  getConversation,
  getDashboard,
  isTauriRuntime,
  listConnectors,
  listProjectContextDocs,
  importDatabaseSnapshot,
  saveConnector,
  saveProjectContextDoc,
  restartAdapter,
  sendMessage as sendAgentMessage,
  setAdapterConfig,
  syncConnector,
} from "@/lib/tauri";
import { AgentCard } from "@/components/AgentCard";
import { AttentionQueue } from "@/components/AttentionQueue";
import { AgentDetailPanel } from "@/components/AgentDetailPanel";
import { ConnectorPanel, type ConnectorDraft } from "@/components/ConnectorPanel";

const EMPTY_DASHBOARD: DashboardView = {
  projects: [],
  needs_attention: [],
  stats: {
    total_agents: 0,
    running: 0,
    idle: 0,
    errored: 0,
    needs_attention: 0,
    files_changed_today: 0,
  },
};

const DEFAULT_CONNECTORS: ConnectorInfo[] = [
  {
    id: "todoist",
    name: "Todoist",
    icon: "✓",
    auth_type: "api_key",
    status: "disconnected",
    capabilities: {
      can_read: true,
      can_write: true,
      can_delete: true,
      can_search: true,
      supports_hierarchy: true,
      supports_due_dates: true,
      supports_priorities: true,
      supports_tags: true,
    },
  },
  {
    id: "obsidian",
    name: "Obsidian",
    icon: "📝",
    auth_type: "local",
    status: "disconnected",
    capabilities: {
      can_read: true,
      can_write: true,
      can_delete: true,
      can_search: true,
      supports_hierarchy: false,
      supports_due_dates: true,
      supports_priorities: true,
      supports_tags: true,
    },
  },
];

const EMPTY_CONNECTOR_DRAFT: ConnectorDraft = {
  authToken: "",
  vaultPath: "",
};

const SETTINGS_STORAGE_KEY = "kanbun.settings.v1";
const MIN_POLL_SECONDS = 1;
const MAX_POLL_SECONDS = 60;
const DEFAULT_WEBHOOK_ENDPOINT = "http://localhost:8765/kanbun/webhook";

const DEFAULT_SETTINGS = {
  dashboardPollSeconds: 4,
  conversationPollSeconds: 2,
};

type ViewMode = "dashboard" | "connectors" | "settings";
type ConnectorBusyState = "idle" | "saving" | "syncing" | "deleting";
type AppSettings = typeof DEFAULT_SETTINGS;
type ProjectDraft = {
  name: string;
  color: string;
};
type AgentPresetId = "mock_demo" | "codex_process" | "claude_code" | "http_webhook" | "custom";

const DEFAULT_WORKSPACE_NAME = "Default Workspace";

type AgentDraft = {
  name: string;
  projectId: string;
  kind: AgentKind;
  functionTag: string;
  workingDirectory: string;
  initialInstruction: string;
  adapterType: AdapterType;
  sessionPrefix: string;
  claudeCommand: string;
  processCommand: string;
  webhookEndpoint: string;
  webhookAuthHeader: string;
  preset: AgentPresetId;
  cliPermissions: string;
};
type QuickWorkstreamDraft = {
  name: string;
  workingDirectory: string;
  preset: AgentPresetId;
  webhookEndpoint: string;
  webhookAuthHeader: string;
  permissions: string;
};
type ContextDocDraft = {
  title: string;
  content: string;
};

const DEFAULT_PROJECT_DRAFT: ProjectDraft = {
  name: "",
  color: "#2c4230",
};

const DEFAULT_AGENT_DRAFT: AgentDraft = {
  name: "",
  projectId: "",
  kind: "terminal",
  functionTag: "engineering",
  workingDirectory: "",
  initialInstruction: "",
  adapterType: "mock",
  sessionPrefix: "kanbun",
  claudeCommand: "claude",
  processCommand: "",
  webhookEndpoint: DEFAULT_WEBHOOK_ENDPOINT,
  webhookAuthHeader: "",
  preset: "mock_demo",
  cliPermissions: "",
};
const DEFAULT_QUICK_WORKSTREAM_DRAFT: QuickWorkstreamDraft = {
  name: "",
  workingDirectory: "",
  preset: "mock_demo",
  webhookEndpoint: DEFAULT_WEBHOOK_ENDPOINT,
  webhookAuthHeader: "",
  permissions: "",
};

const AGENT_PRESETS: { id: AgentPresetId; label: string; description: string }[] = [
  {
    id: "mock_demo",
    label: "Mock (Demo)",
    description: "Fast local demo preset with mock adapter (no external CLI required).",
  },
  {
    id: "codex_process",
    label: "Codex CLI",
    description: "Runs a process adapter using `codex` in the selected workstream folder.",
  },
  {
    id: "claude_code",
    label: "Claude Code",
    description: "Runs Claude Code inside a tmux-backed workstream session.",
  },
  {
    id: "http_webhook",
    label: "HTTP Webhook",
    description: "Posts workstream instructions to an HTTP endpoint (optional AUTH_HEADER).",
  },
  {
    id: "custom",
    label: "Custom",
    description: "Manual setup for adapter and command fields.",
  },
];
const QUICK_AGENT_PRESETS = AGENT_PRESETS.filter((preset) => preset.id !== "custom");

const EMPTY_CONTEXT_DOC_DRAFT: ContextDocDraft = {
  title: "",
  content: "",
};

function isTextualInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return !!target.closest("input, textarea, select, option, [contenteditable='true']");
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown error";
}

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 1024) return `${Math.max(0, Math.round(bytes || 0))} B`;
  const units = ["KB", "MB", "GB"];
  let size = bytes / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function clampPollSeconds(value: number): number {
  return Math.min(MAX_POLL_SECONDS, Math.max(MIN_POLL_SECONDS, Math.round(value)));
}

function sanitizeSettings(input: Partial<AppSettings> | null | undefined): AppSettings {
  return {
    dashboardPollSeconds: clampPollSeconds(input?.dashboardPollSeconds ?? DEFAULT_SETTINGS.dashboardPollSeconds),
    conversationPollSeconds: clampPollSeconds(
      input?.conversationPollSeconds ?? DEFAULT_SETTINGS.conversationPollSeconds
    ),
  };
}

function mergeConnectorInfo(
  runtimeInfos: ConnectorInfo[],
  configMap: Record<string, ConnectorConfig>
): ConnectorInfo[] {
  const runtimeById = Object.fromEntries(runtimeInfos.map((info) => [info.id, info]));
  const merged: ConnectorInfo[] = DEFAULT_CONNECTORS.map((base): ConnectorInfo => {
    const runtime = runtimeById[base.id];
    if (runtime) return runtime;
    if (configMap[base.id]) return { ...base, status: "error" };
    return base;
  });

  for (const runtime of runtimeInfos) {
    if (!merged.some((info) => info.id === runtime.id)) {
      merged.push(runtime);
    }
  }

  return merged;
}

function mergeConversationMessages(existing: Message[], incoming: Message[]): Message[] {
  const byId = new Map<string, Message>();
  for (const message of existing) {
    byId.set(message.id, message);
  }
  for (const message of incoming) {
    byId.set(message.id, message);
  }
  return Array.from(byId.values()).sort((a, b) => {
    const timeDiff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    if (timeDiff !== 0) return timeDiff;
    return a.id.localeCompare(b.id);
  });
}

export default function Dashboard() {
  const [dashboard, setDashboard] = useState<DashboardView>(EMPTY_DASHBOARD);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [isDark, setIsDark] = useState(false);
  const [messagesByAgent, setMessagesByAgent] = useState<Record<string, Message[]>>({});
  const [conversationHasMoreByAgent, setConversationHasMoreByAgent] = useState<Record<string, boolean>>({});
  const [conversationLoadingOlderByAgent, setConversationLoadingOlderByAgent] = useState<
    Record<string, boolean>
  >({});
  const [agentDetailsById, setAgentDetailsById] = useState<Record<string, AgentDetail>>({});
  const [adapterHealthByAgent, setAdapterHealthByAgent] = useState<Record<string, AdapterHealth | null>>({});
  const [adapterHealthLoadingByAgent, setAdapterHealthLoadingByAgent] = useState<Record<string, boolean>>({});
  const [adapterRestartBusyByAgent, setAdapterRestartBusyByAgent] = useState<Record<string, boolean>>({});
  const [isTauri, setIsTauri] = useState(false);
  const [loadingDashboard, setLoadingDashboard] = useState(true);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [settingsDraft, setSettingsDraft] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [backupBusy, setBackupBusy] = useState<"idle" | "exporting" | "importing">("idle");
  const [backupMessage, setBackupMessage] = useState<string | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [projectDraft, setProjectDraft] = useState<ProjectDraft>(DEFAULT_PROJECT_DRAFT);
  const [projectBusy, setProjectBusy] = useState(false);
  const [projectMessage, setProjectMessage] = useState<string | null>(null);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [agentDraft, setAgentDraft] = useState<AgentDraft>(DEFAULT_AGENT_DRAFT);
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentMessage, setAgentMessage] = useState<string | null>(null);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [quickWorkstreamDraft, setQuickWorkstreamDraft] = useState<QuickWorkstreamDraft>(DEFAULT_QUICK_WORKSTREAM_DRAFT);
  const [quickWorkstreamBusy, setQuickWorkstreamBusy] = useState(false);
  const [quickWorkstreamMessage, setQuickWorkstreamMessage] = useState<string | null>(null);
  const [quickWorkstreamError, setQuickWorkstreamError] = useState<string | null>(null);
  const [starterBusy, setStarterBusy] = useState(false);
  const [contextProjectId, setContextProjectId] = useState<string>("");
  const [contextDocsByProject, setContextDocsByProject] = useState<
    Record<string, ProjectContextDocument[]>
  >({});
  const [contextSelectedDocId, setContextSelectedDocId] = useState<string | null>(null);
  const [contextDraft, setContextDraft] = useState<ContextDocDraft>(EMPTY_CONTEXT_DOC_DRAFT);
  const [contextLoading, setContextLoading] = useState(false);
  const [contextSaving, setContextSaving] = useState(false);
  const [contextDeleting, setContextDeleting] = useState(false);
  const [contextMessage, setContextMessage] = useState<string | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);

  const [activeView, setActiveView] = useState<ViewMode>("dashboard");
  const [connectors, setConnectors] = useState<ConnectorInfo[]>(DEFAULT_CONNECTORS);
  const [connectorConfigs, setConnectorConfigs] = useState<Record<string, ConnectorConfig>>({});
  const [selectedConnectorId, setSelectedConnectorId] = useState<string>("todoist");
  const [connectorDrafts, setConnectorDrafts] = useState<Record<string, ConnectorDraft>>({
    todoist: { ...EMPTY_CONNECTOR_DRAFT },
    obsidian: { ...EMPTY_CONNECTOR_DRAFT },
  });
  const [connectorItemsByType, setConnectorItemsByType] = useState<Record<string, ConnectorItem[]>>({});
  const [connectorBusyByType, setConnectorBusyByType] = useState<Record<string, ConnectorBusyState>>({});
  const [connectorMessage, setConnectorMessage] = useState<string | null>(null);
  const [connectorError, setConnectorError] = useState<string | null>(null);
  const dashboardPollMs = settings.dashboardPollSeconds * 1000;
  const conversationPollMs = settings.conversationPollSeconds * 1000;
  const hasUnsavedSettings =
    settingsDraft.dashboardPollSeconds !== settings.dashboardPollSeconds ||
    settingsDraft.conversationPollSeconds !== settings.conversationPollSeconds;

  const refreshDashboard = useCallback(async () => {
    try {
      const data = await getDashboard();
      setDashboard(data);
      setDashboardError(null);
    } catch (error) {
      setDashboardError(toErrorMessage(error));
    } finally {
      setLoadingDashboard(false);
    }
  }, []);

  const refreshConversation = useCallback(async (agentId: string) => {
    try {
      const thread = await getConversation(agentId, 100);
      setMessagesByAgent((prev) => ({
        ...prev,
        [agentId]: mergeConversationMessages(prev[agentId] ?? [], thread.messages),
      }));
      setConversationHasMoreByAgent((prev) => ({
        ...prev,
        [agentId]: thread.has_more,
      }));
    } catch (error) {
      console.error("Failed to load conversation:", error);
    }
  }, []);

  const loadOlderConversation = useCallback(
    async (agentId: string) => {
      if (!isTauri) return;
      const existingMessages = messagesByAgent[agentId] ?? [];
      const beforeCreatedAt = existingMessages[0]?.created_at;
      if (!beforeCreatedAt) return;

      setConversationLoadingOlderByAgent((prev) => ({
        ...prev,
        [agentId]: true,
      }));
      try {
        const thread = await getConversation(agentId, 100, beforeCreatedAt);
        setMessagesByAgent((prev) => ({
          ...prev,
          [agentId]: mergeConversationMessages(thread.messages, prev[agentId] ?? []),
        }));
        setConversationHasMoreByAgent((prev) => ({
          ...prev,
          [agentId]: thread.has_more,
        }));
      } catch (error) {
        setDashboardError(`Failed to load older conversation: ${toErrorMessage(error)}`);
      } finally {
        setConversationLoadingOlderByAgent((prev) => ({
          ...prev,
          [agentId]: false,
        }));
      }
    },
    [isTauri, messagesByAgent]
  );

  const refreshAgentDetail = useCallback(
    async (agentId: string) => {
      if (!isTauri) return;
      try {
        const detail = await getAgentDetail(agentId);
        setAgentDetailsById((prev) => ({
          ...prev,
          [agentId]: detail,
        }));
      } catch (error) {
        setDashboardError(`Failed to load agent detail: ${toErrorMessage(error)}`);
      }
    },
    [isTauri]
  );

  const refreshAdapterHealth = useCallback(
    async (agentId: string) => {
      if (!isTauri) return;
      setAdapterHealthLoadingByAgent((prev) => ({ ...prev, [agentId]: true }));
      try {
        const health = await getAdapterHealth(agentId);
        setAdapterHealthByAgent((prev) => ({ ...prev, [agentId]: health }));
      } catch (error) {
        setDashboardError(`Adapter health check failed: ${toErrorMessage(error)}`);
      } finally {
        setAdapterHealthLoadingByAgent((prev) => ({ ...prev, [agentId]: false }));
      }
    },
    [isTauri]
  );

  const refreshConnectors = useCallback(async () => {
    if (!isTauri) return;
    try {
      const [runtimeInfos, savedConfigs] = await Promise.all([
        listConnectors(),
        getConnectorConfigs(),
      ]);

      const configMap = Object.fromEntries(
        savedConfigs.map((config) => [config.connector_type, config])
      );

      setConnectorConfigs(configMap);
      setConnectors(mergeConnectorInfo(runtimeInfos, configMap));
      setConnectorError(null);

      setConnectorDrafts((prev) => {
        const next = { ...prev };
        for (const config of savedConfigs) {
          next[config.connector_type] = {
            authToken: config.auth_token ?? next[config.connector_type]?.authToken ?? "",
            vaultPath: config.settings.vault_path ?? next[config.connector_type]?.vaultPath ?? "",
          };
        }
        return next;
      });
    } catch (error) {
      setConnectorError(toErrorMessage(error));
    }
  }, [isTauri]);

  const refreshConnectorItems = useCallback(
    async (connectorType: string) => {
      if (!isTauri) return;
      try {
        const items = await getConnectorItems(connectorType);
        setConnectorItemsByType((prev) => ({
          ...prev,
          [connectorType]: items,
        }));
      } catch (error) {
        setConnectorError(`Failed to load ${connectorType} items: ${toErrorMessage(error)}`);
      }
    },
    [isTauri]
  );

  const refreshProjectContextDocs = useCallback(
    async (projectId: string) => {
      if (!isTauri || !projectId) return;
      setContextLoading(true);
      try {
        const docs = await listProjectContextDocs(projectId);
        setContextDocsByProject((prev) => ({
          ...prev,
          [projectId]: docs,
        }));
        setContextSelectedDocId((prevSelected) => {
          const nextId =
            prevSelected && docs.some((doc) => doc.id === prevSelected)
              ? prevSelected
              : docs[0]?.id ?? null;
          const nextDoc = docs.find((doc) => doc.id === nextId);
          setContextDraft(
            nextDoc
              ? { title: nextDoc.title, content: nextDoc.content }
              : EMPTY_CONTEXT_DOC_DRAFT
          );
          return nextId;
        });
        setContextError(null);
      } catch (error) {
        setContextError(`Failed to load project context: ${toErrorMessage(error)}`);
      } finally {
        setContextLoading(false);
      }
    },
    [isTauri]
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as Partial<AppSettings>;
      const hydrated = sanitizeSettings(parsed);
      setSettings(hydrated);
      setSettingsDraft(hydrated);
    } catch (error) {
      console.warn("Failed to parse stored settings:", error);
    }
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", isDark ? "dark" : "");
  }, [isDark]);

  useEffect(() => {
    const runningInTauri = isTauriRuntime();
    setIsTauri(runningInTauri);

    if (!runningInTauri) {
      setLoadingDashboard(false);
      setDashboard(EMPTY_DASHBOARD);
      setConnectors(DEFAULT_CONNECTORS);
      setConnectorConfigs({});
    }
  }, []);

  useEffect(() => {
    if (!isTauri) return;

    let cancelled = false;
    const syncDashboard = async () => {
      try {
        const data = await getDashboard();
        if (cancelled) return;
        setDashboard(data);
        setDashboardError(null);
      } catch (error) {
        if (cancelled) return;
        setDashboardError(toErrorMessage(error));
      } finally {
        if (!cancelled) setLoadingDashboard(false);
      }
    };

    void syncDashboard();
    const intervalId = window.setInterval(() => {
      void syncDashboard();
    }, dashboardPollMs);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [isTauri, dashboardPollMs]);

  useEffect(() => {
    if (!isTauri || !selectedAgentId) return;

    let cancelled = false;
    const syncConversation = async () => {
      try {
        const [, detail, health] = await Promise.all([
          refreshConversation(selectedAgentId),
          getAgentDetail(selectedAgentId),
          getAdapterHealth(selectedAgentId),
        ]);
        if (cancelled) return;
        setAgentDetailsById((prev) => ({
          ...prev,
          [selectedAgentId]: detail,
        }));
        setAdapterHealthByAgent((prev) => ({
          ...prev,
          [selectedAgentId]: health,
        }));
      } catch (error) {
        if (!cancelled) console.error("Failed to refresh conversation:", error);
      }
    };

    void syncConversation();
    const intervalId = window.setInterval(() => {
      void syncConversation();
    }, conversationPollMs);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [isTauri, selectedAgentId, conversationPollMs, refreshConversation]);

  useEffect(() => {
    if (!isTauri || !selectedAgentId) return;
    void refreshAgentDetail(selectedAgentId);
    void refreshAdapterHealth(selectedAgentId);
  }, [isTauri, selectedAgentId, refreshAgentDetail, refreshAdapterHealth]);

  useEffect(() => {
    if (!isTauri) return;
    void refreshConnectors();
  }, [isTauri, refreshConnectors]);

  useEffect(() => {
    if (!isTauri || activeView !== "connectors") return;
    void refreshConnectorItems(selectedConnectorId);
  }, [isTauri, activeView, selectedConnectorId, refreshConnectorItems]);

  useEffect(() => {
    if (!isTauri || !contextProjectId) return;
    void refreshProjectContextDocs(contextProjectId);
  }, [isTauri, contextProjectId, refreshProjectContextDocs]);

  useEffect(() => {
    if (dashboard.projects.length === 0) {
      setContextProjectId("");
      setContextSelectedDocId(null);
      setContextDraft(EMPTY_CONTEXT_DOC_DRAFT);
      return;
    }
    const hasSelectedProject = dashboard.projects.some(
      (projectGroup) => projectGroup.project.id === agentDraft.projectId
    );
    if (!hasSelectedProject) {
      setAgentDraft((prev) => ({
        ...prev,
        projectId: dashboard.projects[0].project.id,
      }));
    }
    const hasContextProject = dashboard.projects.some(
      (projectGroup) => projectGroup.project.id === contextProjectId
    );
    if (!hasContextProject) {
      setContextProjectId(dashboard.projects[0].project.id);
    }
  }, [dashboard.projects, agentDraft.projectId, contextProjectId]);

  const selectedAgent = selectedAgentId
    ? dashboard.projects.flatMap((project) => project.agents).find((agent) => agent.agent.id === selectedAgentId)
    : null;

  const selectedProject = selectedAgentId
    ? dashboard.projects.find((project) => project.agents.some((agent) => agent.agent.id === selectedAgentId))
    : null;
  const selectedAgentDetail = selectedAgentId ? agentDetailsById[selectedAgentId] : undefined;
  const selectedAgentRuns =
    selectedAgentDetail?.runs ??
    (selectedAgent?.recent_run ? [selectedAgent.recent_run] : []);
  const selectedAdapterConfig = selectedAgentDetail?.adapter_config ?? null;
  const selectedAdapterHealth = selectedAgentId ? (adapterHealthByAgent[selectedAgentId] ?? null) : null;
  const selectedAdapterHealthLoading = selectedAgentId ? Boolean(adapterHealthLoadingByAgent[selectedAgentId]) : false;
  const selectedAdapterRestartBusy = selectedAgentId ? Boolean(adapterRestartBusyByAgent[selectedAgentId]) : false;
  const selectedConversationHasMore = selectedAgentId
    ? Boolean(conversationHasMoreByAgent[selectedAgentId])
    : false;
  const selectedConversationLoadingOlder = selectedAgentId
    ? Boolean(conversationLoadingOlderByAgent[selectedAgentId])
    : false;

  const handleSendMessage = useCallback(
    (agentId: string, kind: MessageKind, content: string) => {
      if (!isTauri) {
        setDashboardError("Messaging is available only in the desktop runtime.");
        return;
      }

      const resolvedContent = content.trim() || `[${kind}]`;
      void (async () => {
        try {
          await sendAgentMessage(agentId, kind, resolvedContent);
          await Promise.all([
            refreshConversation(agentId),
            refreshAgentDetail(agentId),
            refreshAdapterHealth(agentId),
            refreshDashboard(),
          ]);
        } catch (error) {
          setDashboardError(`Message send failed: ${toErrorMessage(error)}`);
        }
      })();
    },
    [isTauri, refreshConversation, refreshAgentDetail, refreshAdapterHealth, refreshDashboard]
  );

  const handleAttentionAction = useCallback(
    (agentId: string, action: "retry" | "debug" | "approve" | "deny" | "inspect") => {
      setSelectedAgentId(agentId);
      if (action === "inspect") return;

      if (!isTauri) {
        setDashboardError("Attention actions are available only in desktop runtime.");
        return;
      }

      const payload: { kind: MessageKind; content: string } =
        action === "retry"
          ? {
              kind: "instruction",
              content: "Retry the last failed task and provide a concise root-cause summary.",
            }
          : action === "debug"
          ? {
              kind: "instruction",
              content: "Provide a debug analysis of the failure with a concrete fix plan.",
            }
          : action === "approve"
          ? {
              kind: "instruction",
              content: "Approved. Continue execution and report the final result.",
            }
          : {
              kind: "instruction",
              content: "Denied. Stop and wait for updated instructions.",
            };

      void (async () => {
        try {
          await sendAgentMessage(agentId, payload.kind, payload.content);
          await Promise.all([
            refreshConversation(agentId),
            refreshAgentDetail(agentId),
            refreshAdapterHealth(agentId),
            refreshDashboard(),
          ]);
        } catch (error) {
          setDashboardError(`Attention action failed: ${toErrorMessage(error)}`);
        }
      })();
    },
    [isTauri, refreshConversation, refreshAgentDetail, refreshAdapterHealth, refreshDashboard]
  );

  const handleSettingsFieldChange = useCallback(
    (key: keyof AppSettings, value: number) => {
      if (!Number.isFinite(value)) return;
      setSettingsDraft((prev) => ({
        ...prev,
        [key]: clampPollSeconds(value),
      }));
      setSettingsMessage(null);
    },
    []
  );

  const handleProjectDraftChange = useCallback((patch: Partial<ProjectDraft>) => {
    setProjectDraft((prev) => ({ ...prev, ...patch }));
    setProjectMessage(null);
    setProjectError(null);
  }, []);

  const handleAgentDraftChange = useCallback((patch: Partial<AgentDraft>) => {
    setAgentDraft((prev) => ({ ...prev, ...patch }));
    setAgentMessage(null);
    setAgentError(null);
  }, []);

  const handleQuickWorkstreamDraftChange = useCallback((patch: Partial<QuickWorkstreamDraft>) => {
    setQuickWorkstreamDraft((prev) => ({ ...prev, ...patch }));
    setQuickWorkstreamMessage(null);
    setQuickWorkstreamError(null);
  }, []);

  const buildAdapterEnv = useCallback((permissions: string) => {
    const normalized = permissions.trim();
    return normalized ? { KANBUN_CLI_PERMISSIONS: normalized } : null;
  }, []);

  const buildWebhookEnv = useCallback((authHeader: string) => {
    const normalized = authHeader.trim();
    return normalized ? { AUTH_HEADER: normalized } : null;
  }, []);

  const buildAdapterConfig = useCallback((draft: AgentDraft, workingDirectory: string, cliPermissions = "") => {
    return draft.adapterType === "claude_code"
      ? ({
          adapter_type: "claude_code" as const,
          session_name: draft.sessionPrefix.trim() || "kanbun",
          endpoint: draft.claudeCommand.trim() || "claude",
          command: workingDirectory || null,
          env: buildAdapterEnv(cliPermissions),
        } as const)
      : draft.adapterType === "http_webhook"
      ? ({
          adapter_type: "http_webhook" as const,
          session_name: null,
          endpoint: draft.webhookEndpoint.trim() || DEFAULT_WEBHOOK_ENDPOINT,
          command: null,
          env: buildWebhookEnv(draft.webhookAuthHeader),
        } as const)
      : draft.adapterType === "process"
      ? ({
          adapter_type: "process" as const,
          session_name: null,
          endpoint: null,
          command: draft.processCommand.trim(),
          env: buildAdapterEnv(cliPermissions),
        } as const)
      : ({
          adapter_type: "mock" as const,
          session_name: null,
          endpoint: null,
          command: null,
          env: buildAdapterEnv(cliPermissions),
        } as const);
  }, [buildAdapterEnv, buildWebhookEnv]);

  const buildQuickAgentConfig = useCallback(
    (
      preset: AgentPresetId,
      workingDirectory: string,
      cliPermissions: string,
      webhookEndpoint = DEFAULT_WEBHOOK_ENDPOINT,
      webhookAuthHeader = ""
    ): AdapterConfig => {
      if (preset === "codex_process") {
        return {
          adapter_type: "process" as const,
          session_name: null,
          endpoint: null,
          command: "codex",
          env: buildAdapterEnv(cliPermissions),
        };
      }
      if (preset === "claude_code") {
        return {
          adapter_type: "claude_code" as const,
          session_name: "kanbun",
          endpoint: "claude",
          command: workingDirectory || null,
          env: buildAdapterEnv(cliPermissions),
        };
      }
      if (preset === "http_webhook") {
        return {
          adapter_type: "http_webhook" as const,
          session_name: null,
          endpoint: webhookEndpoint.trim() || DEFAULT_WEBHOOK_ENDPOINT,
          command: null,
          env: buildWebhookEnv(webhookAuthHeader),
        };
      }
      return {
        adapter_type: "mock" as const,
        session_name: null,
        endpoint: null,
        command: null,
        env: buildAdapterEnv(cliPermissions),
      };
    },
    [buildAdapterEnv, buildWebhookEnv]
  );

  const handlePickQuickWorkingDirectory = useCallback(async () => {
    if (!isTauri) {
      setQuickWorkstreamError("Folder picker is available only in desktop runtime.");
      return;
    }
    try {
      const picked = await open({
        directory: true,
        multiple: false,
      });
      if (typeof picked === "string" && picked.trim()) {
        handleQuickWorkstreamDraftChange({ workingDirectory: picked });
      }
    } catch (error) {
      setQuickWorkstreamError(`Folder pick failed: ${toErrorMessage(error)}`);
    }
  }, [handleQuickWorkstreamDraftChange, isTauri]);

  const handleCreateQuickWorkstream = useCallback(async () => {
    if (!isTauri) {
      setQuickWorkstreamError("Workstream creation is available only in desktop runtime.");
      return;
    }
    const workingDirectory = quickWorkstreamDraft.workingDirectory.trim();
    if (!workingDirectory) {
      setQuickWorkstreamError("Select a workspace folder first.");
      return;
    }
    if (quickWorkstreamDraft.preset === "http_webhook" && !quickWorkstreamDraft.webhookEndpoint.trim()) {
      setQuickWorkstreamError("Webhook endpoint is required.");
      return;
    }

    const normalizedPreset = QUICK_AGENT_PRESETS.some((item) => item.id === quickWorkstreamDraft.preset)
      ? quickWorkstreamDraft.preset
      : "mock_demo";
    const workstreamName = quickWorkstreamDraft.name.trim() || "Workstream";

    setQuickWorkstreamBusy(true);
    setQuickWorkstreamError(null);
    setQuickWorkstreamMessage(null);

    try {
      const selectedProject = dashboard.projects.find(
        (projectGroup) => projectGroup.project.name === DEFAULT_WORKSPACE_NAME
      );
      const workspace = selectedProject
        ? null
        : await createProject(DEFAULT_WORKSPACE_NAME, DEFAULT_PROJECT_DRAFT.color);
      const workspaceId = selectedProject?.project.id ?? workspace?.id ?? "";
      const workspaceName = selectedProject?.project.name ?? workspace?.name ?? DEFAULT_WORKSPACE_NAME;

      const created = await createAgent({
        name: workstreamName,
        projectId: workspaceId,
        kind: "terminal",
        functionTag: "engineering",
        workingDirectory,
      });

      await setAdapterConfig(
        created.id,
        buildQuickAgentConfig(
          normalizedPreset,
          workingDirectory,
          quickWorkstreamDraft.permissions,
          quickWorkstreamDraft.webhookEndpoint,
          quickWorkstreamDraft.webhookAuthHeader
        )
      );
      await Promise.all([refreshDashboard(), refreshConversation(created.id)]);
      setAgentDraft((prev) => ({ ...prev, projectId: created.project_id }));
      setSelectedAgentId(created.id);
      setQuickWorkstreamMessage(`Workstream "${created.name}" created in ${workspaceName}.`);
      setQuickWorkstreamDraft((prev) => ({
        ...prev,
        name: "",
      }));
    } catch (error) {
      setQuickWorkstreamError(`Quick start failed: ${toErrorMessage(error)}`);
    } finally {
      setQuickWorkstreamBusy(false);
    }
  }, [
    buildQuickAgentConfig,
    createAgent,
    createProject,
    dashboard.projects,
    isTauri,
    quickWorkstreamDraft.name,
    quickWorkstreamDraft.permissions,
    quickWorkstreamDraft.preset,
    quickWorkstreamDraft.workingDirectory,
    quickWorkstreamDraft.webhookAuthHeader,
    quickWorkstreamDraft.webhookEndpoint,
    refreshConversation,
    refreshDashboard,
  ]);
  const handleApplyAgentPreset = useCallback((preset: AgentPresetId) => {
    setAgentDraft((prev) => {
      const next: AgentDraft = {
        ...prev,
        preset,
      };

      switch (preset) {
        case "mock_demo":
          return {
            ...next,
            adapterType: "mock",
            kind: "terminal",
          };
        case "codex_process":
          return {
            ...next,
            adapterType: "process",
            kind: "terminal",
            processCommand: prev.processCommand.trim() ? prev.processCommand : "codex",
          };
        case "claude_code":
          return {
            ...next,
            adapterType: "claude_code",
            kind: "terminal",
            sessionPrefix: prev.sessionPrefix.trim() ? prev.sessionPrefix : "kanbun",
            claudeCommand: prev.claudeCommand.trim() ? prev.claudeCommand : "claude",
          };
        case "http_webhook":
          return {
            ...next,
            adapterType: "http_webhook",
            kind: "terminal",
            webhookEndpoint: prev.webhookEndpoint.trim() || DEFAULT_WEBHOOK_ENDPOINT,
          };
        case "custom":
        default:
          return next;
      }
    });
    setAgentMessage(null);
    setAgentError(null);
  }, []);

  const handlePickWorkingDirectory = useCallback(async () => {
    if (!isTauri) {
      setAgentError("Folder picker is available only in desktop runtime.");
      return;
    }
    try {
      const picked = await open({
        directory: true,
        multiple: false,
      });
      if (typeof picked === "string" && picked.trim()) {
        handleAgentDraftChange({ workingDirectory: picked });
      }
    } catch (error) {
      setAgentError(`Folder pick failed: ${toErrorMessage(error)}`);
    }
  }, [handleAgentDraftChange, isTauri]);

  const handleSelectContextDoc = useCallback(
    (docId: string) => {
      const docs = contextDocsByProject[contextProjectId] ?? [];
      const doc = docs.find((item) => item.id === docId);
      setContextSelectedDocId(docId);
      setContextDraft(
        doc ? { title: doc.title, content: doc.content } : EMPTY_CONTEXT_DOC_DRAFT
      );
      setContextMessage(null);
      setContextError(null);
    },
    [contextDocsByProject, contextProjectId]
  );

  const handleCreateContextDoc = useCallback(() => {
    setContextSelectedDocId(null);
    setContextDraft(EMPTY_CONTEXT_DOC_DRAFT);
    setContextMessage(null);
    setContextError(null);
  }, []);

  const handleSaveContextDoc = useCallback(async () => {
    if (!isTauri) {
      setContextError("Project context is available only in desktop runtime.");
      return;
    }
    if (!contextProjectId) {
      setContextError("Select a project first.");
      return;
    }

    setContextSaving(true);
    try {
      const saved = await saveProjectContextDoc(
        contextProjectId,
        contextDraft.title,
        contextDraft.content,
        contextSelectedDocId ?? undefined
      );
      await refreshProjectContextDocs(contextProjectId);
      setContextSelectedDocId(saved.id);
      setContextDraft({ title: saved.title, content: saved.content });
      setContextMessage(`Context "${saved.title}" saved.`);
      setContextError(null);
    } catch (error) {
      setContextError(`Save failed: ${toErrorMessage(error)}`);
    } finally {
      setContextSaving(false);
    }
  }, [
    contextDraft.content,
    contextDraft.title,
    contextProjectId,
    contextSelectedDocId,
    isTauri,
    refreshProjectContextDocs,
  ]);

  const handleDeleteContextDoc = useCallback(async () => {
    if (!isTauri) {
      setContextError("Project context is available only in desktop runtime.");
      return;
    }
    if (!contextSelectedDocId) {
      setContextError("Select a context document first.");
      return;
    }

    setContextDeleting(true);
    try {
      await deleteProjectContextDoc(contextSelectedDocId);
      await refreshProjectContextDocs(contextProjectId);
      setContextMessage("Context document deleted.");
      setContextError(null);
    } catch (error) {
      setContextError(`Delete failed: ${toErrorMessage(error)}`);
    } finally {
      setContextDeleting(false);
    }
  }, [contextProjectId, contextSelectedDocId, isTauri, refreshProjectContextDocs]);

  const handleCreateProject = useCallback(async () => {
    if (!isTauri) {
      setProjectError("Project creation is available only in desktop runtime.");
      return;
    }

    const name = projectDraft.name.trim();
    if (!name) {
      setProjectError("Project name is required.");
      return;
    }

    setProjectBusy(true);
    try {
      const project = await createProject(name, projectDraft.color.trim() || DEFAULT_PROJECT_DRAFT.color);
      await refreshDashboard();
      setProjectDraft(DEFAULT_PROJECT_DRAFT);
      setAgentDraft((prev) => ({ ...prev, projectId: project.id }));
      setProjectMessage(`Project "${project.name}" created.`);
      setProjectError(null);
    } catch (error) {
      setProjectError(`Create project failed: ${toErrorMessage(error)}`);
    } finally {
      setProjectBusy(false);
    }
  }, [isTauri, projectDraft, refreshDashboard]);

  const handleCreateAgent = useCallback(async () => {
    if (!isTauri) {
      setAgentError("Agent creation is available only in desktop runtime.");
      return;
    }

    const name = agentDraft.name.trim();
    if (!name) {
      setAgentError("Agent name is required.");
      return;
    }
    if (!agentDraft.projectId) {
      setAgentError("Select a project first.");
      return;
    }
    if (agentDraft.adapterType === "process" && !agentDraft.processCommand.trim()) {
      setAgentError("Process command is required for process adapter.");
      return;
    }
    if (agentDraft.adapterType === "http_webhook" && !agentDraft.webhookEndpoint.trim()) {
      setAgentError("Webhook endpoint is required.");
      return;
    }

    setAgentBusy(true);
    try {
      const functionTag = agentDraft.functionTag.trim() || "engineering";
      const workingDirectory = agentDraft.workingDirectory.trim();
      const initialInstruction = agentDraft.initialInstruction.trim();

      const created = await createAgent({
        name,
        projectId: agentDraft.projectId,
        kind: agentDraft.kind,
        functionTag,
        ...(workingDirectory ? { workingDirectory } : {}),
      });

      await setAdapterConfig(created.id, buildAdapterConfig(agentDraft, workingDirectory, agentDraft.cliPermissions));
      if (initialInstruction) {
        await sendAgentMessage(created.id, "instruction", initialInstruction);
      }

      await Promise.all([
        refreshDashboard(),
        refreshConversation(created.id),
        refreshAgentDetail(created.id),
        refreshAdapterHealth(created.id),
      ]);

      setSelectedAgentId(created.id);
      setActiveView("dashboard");
      setAgentDraft((prev) => ({
        ...DEFAULT_AGENT_DRAFT,
        projectId: prev.projectId || created.project_id,
      }));
      setAgentMessage(
        initialInstruction
          ? `Workstream "${created.name}" created and started.`
          : `Workstream "${created.name}" created.`
      );
      setAgentError(null);
    } catch (error) {
      setAgentError(`Create agent failed: ${toErrorMessage(error)}`);
    } finally {
      setAgentBusy(false);
    }
  }, [
    agentDraft,
    buildAdapterConfig,
    isTauri,
    refreshAdapterHealth,
    refreshAgentDetail,
    refreshConversation,
    refreshDashboard,
  ]);

  const handleCreateStarterWorkspace = useCallback(async () => {
    if (!isTauri) {
      setDashboardError("Starter setup is available only in desktop runtime.");
      return;
    }
    if (starterBusy) return;

    setStarterBusy(true);
    setDashboardError(null);
    setProjectError(null);
    setAgentError(null);

    try {
      const project = await createProject("Kanbun Workspace", DEFAULT_PROJECT_DRAFT.color);
      const agent = await createAgent({
        name: "Kanbun Core Agent",
        projectId: project.id,
        kind: "terminal",
        functionTag: "engineering",
      });

      await setAdapterConfig(agent.id, {
        adapter_type: "mock",
        session_name: null,
        endpoint: null,
        command: null,
        env: null,
      });

      await Promise.all([refreshDashboard(), refreshConversation(agent.id)]);
      setSelectedAgentId(agent.id);
      setActiveView("dashboard");
      setAgentDraft((prev) => ({ ...prev, projectId: project.id }));
      setProjectMessage(`Project "${project.name}" created.`);
      setAgentMessage(`Agent "${agent.name}" created.`);
    } catch (error) {
      setDashboardError(`Starter setup failed: ${toErrorMessage(error)}`);
    } finally {
      setStarterBusy(false);
    }
  }, [isTauri, refreshConversation, refreshDashboard, starterBusy]);

  const handleSaveSettings = useCallback(() => {
    const next = sanitizeSettings(settingsDraft);
    setSettings(next);
    setSettingsDraft(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next));
    }
    setSettingsMessage("Settings saved.");
  }, [settingsDraft]);

  const handleResetSettings = useCallback(() => {
    setSettings(DEFAULT_SETTINGS);
    setSettingsDraft(DEFAULT_SETTINGS);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(DEFAULT_SETTINGS));
    }
    setSettingsMessage("Reset to defaults.");
  }, []);

  const handleExportDatabaseSnapshot = useCallback(async () => {
    if (!isTauri) {
      setBackupError("Database backup is available only in desktop runtime.");
      return;
    }

    const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
    const selected = await save({
      defaultPath: `kanbun-backup-${stamp}.db`,
      filters: [{ name: "SQLite DB", extensions: ["db", "sqlite", "sqlite3"] }],
    });

    if (!selected) {
      setBackupMessage("Export canceled.");
      setBackupError(null);
      return;
    }

    setBackupBusy("exporting");
    setBackupMessage(null);
    setBackupError(null);
    try {
      const result: DatabaseSnapshotResult = await exportDatabaseSnapshot(selected);
      setBackupMessage(`Exported ${formatFileSize(result.size_bytes)} to ${result.path}.`);
    } catch (error) {
      setBackupError(`Export failed: ${toErrorMessage(error)}`);
    } finally {
      setBackupBusy("idle");
    }
  }, [isTauri]);

  const handleImportDatabaseSnapshot = useCallback(async () => {
    if (!isTauri) {
      setBackupError("Database restore is available only in desktop runtime.");
      return;
    }

    const selected = await open({
      directory: false,
      multiple: false,
      filters: [{ name: "SQLite DB", extensions: ["db", "sqlite", "sqlite3"] }],
    });
    const sourcePath = Array.isArray(selected) ? selected[0] : selected;
    if (!sourcePath) {
      setBackupMessage("Import canceled.");
      setBackupError(null);
      return;
    }

    if (
      typeof window !== "undefined" &&
      !window.confirm(
        "Importing will replace current Kanbun local data (projects, workstreams, history, and settings). Continue?"
      )
    ) {
      setBackupMessage("Import canceled.");
      setBackupError(null);
      return;
    }

    setBackupBusy("importing");
    setBackupMessage(null);
    setBackupError(null);
    try {
      const result: DatabaseSnapshotResult = await importDatabaseSnapshot(sourcePath);
      setSelectedAgentId(null);
      setMessagesByAgent({});
      setConversationHasMoreByAgent({});
      setConversationLoadingOlderByAgent({});
      setAgentDetailsById({});
      setAdapterHealthByAgent({});
      setAdapterHealthLoadingByAgent({});
      setAdapterRestartBusyByAgent({});
      await Promise.all([refreshDashboard(), refreshConnectors()]);
      if (contextProjectId) {
        await refreshProjectContextDocs(contextProjectId);
      }
      setBackupMessage(`Imported ${formatFileSize(result.size_bytes)} from ${result.path}.`);
    } catch (error) {
      setBackupError(`Import failed: ${toErrorMessage(error)}`);
    } finally {
      setBackupBusy("idle");
    }
  }, [contextProjectId, isTauri, refreshConnectors, refreshDashboard, refreshProjectContextDocs]);

  const handleConnectorDraftChange = useCallback(
    (connectorType: string, patch: Partial<ConnectorDraft>) => {
      setConnectorDrafts((prev) => ({
        ...prev,
        [connectorType]: {
          ...(prev[connectorType] ?? EMPTY_CONNECTOR_DRAFT),
          ...patch,
        },
      }));
    },
    []
  );

  const handleSaveConnector = useCallback(
    async (connectorType: string) => {
      if (!isTauri) {
        setConnectorError("Connector config is available only in desktop runtime.");
        return;
      }

      const draft = connectorDrafts[connectorType] ?? EMPTY_CONNECTOR_DRAFT;
      const payload: ConnectorConfig = {
        connector_type: connectorType,
        auth_token: connectorType === "todoist" ? draft.authToken.trim() || null : null,
        settings:
          connectorType === "obsidian" && draft.vaultPath.trim()
            ? { vault_path: draft.vaultPath.trim() }
            : {},
        enabled: true,
      };

      setConnectorBusyByType((prev) => ({ ...prev, [connectorType]: "saving" }));
      try {
        await saveConnector(payload);
        await refreshConnectors();
        await refreshConnectorItems(connectorType);
        setConnectorMessage(`${connectorType} config saved.`);
        setConnectorError(null);
      } catch (error) {
        setConnectorError(`Save failed: ${toErrorMessage(error)}`);
      } finally {
        setConnectorBusyByType((prev) => ({ ...prev, [connectorType]: "idle" }));
      }
    },
    [connectorDrafts, isTauri, refreshConnectors, refreshConnectorItems]
  );

  const handleSyncConnector = useCallback(
    async (connectorType: string) => {
      if (!isTauri) {
        setConnectorError("Sync is available only in desktop runtime.");
        return;
      }

      setConnectorBusyByType((prev) => ({ ...prev, [connectorType]: "syncing" }));
      try {
        const result = await syncConnector(connectorType);
        await Promise.all([
          refreshConnectorItems(connectorType),
          refreshConnectors(),
          refreshDashboard(),
        ]);
        setConnectorMessage(`${connectorType} synced: pulled ${result.pulled} items.`);
        setConnectorError(null);
      } catch (error) {
        setConnectorError(`Sync failed: ${toErrorMessage(error)}`);
      } finally {
        setConnectorBusyByType((prev) => ({ ...prev, [connectorType]: "idle" }));
      }
    },
    [isTauri, refreshConnectorItems, refreshConnectors, refreshDashboard]
  );

  const handleDeleteConnectorItem = useCallback(
    async (connectorType: string, itemId: string) => {
      if (!isTauri) {
        setConnectorError("Delete is available only in desktop runtime.");
        return;
      }

      setConnectorBusyByType((prev) => ({ ...prev, [connectorType]: "deleting" }));
      try {
        await deleteConnectorItem(connectorType, itemId);
        await refreshConnectorItems(connectorType);
        setConnectorMessage(`${connectorType} item deleted.`);
        setConnectorError(null);
      } catch (error) {
        setConnectorError(`Delete failed: ${toErrorMessage(error)}`);
      } finally {
        setConnectorBusyByType((prev) => ({ ...prev, [connectorType]: "idle" }));
      }
    },
    [isTauri, refreshConnectorItems]
  );

  const handleRestartAdapter = useCallback(
    async (agentId: string) => {
      if (!isTauri) {
        setDashboardError("Adapter restart is available only in desktop runtime.");
        return;
      }

      setAdapterRestartBusyByAgent((prev) => ({ ...prev, [agentId]: true }));
      try {
        const health = await restartAdapter(agentId);
        setAdapterHealthByAgent((prev) => ({ ...prev, [agentId]: health }));
        await Promise.all([
          refreshAgentDetail(agentId),
          refreshConversation(agentId),
          refreshDashboard(),
        ]);
      } catch (error) {
        setDashboardError(`Adapter restart failed: ${toErrorMessage(error)}`);
      } finally {
        setAdapterRestartBusyByAgent((prev) => ({ ...prev, [agentId]: false }));
      }
    },
    [isTauri, refreshAgentDetail, refreshConversation, refreshDashboard]
  );

  const handleSaveAdapterConfig = useCallback(
    async (agentId: string, config: AdapterConfig) => {
      if (!isTauri) {
        throw new Error("Adapter config save is available only in desktop runtime.");
      }

      await setAdapterConfig(agentId, config);
      await Promise.all([
        refreshAgentDetail(agentId),
        refreshAdapterHealth(agentId),
        refreshConversation(agentId),
        refreshDashboard(),
      ]);
    },
    [isTauri, refreshAgentDetail, refreshAdapterHealth, refreshConversation, refreshDashboard]
  );

  const quickPresetHelp =
    QUICK_AGENT_PRESETS.find((preset) => preset.id === quickWorkstreamDraft.preset)?.description ??
    "Choose an adapter preset for your workstream.";
  const selectedConnectorItems = connectorItemsByType[selectedConnectorId] ?? [];
  const selectedConnectorBusy = connectorBusyByType[selectedConnectorId] ?? "idle";
  const selectedContextDocs = contextProjectId ? contextDocsByProject[contextProjectId] ?? [] : [];

  return (
    <div className="h-screen flex flex-col">
      <div className="crt-overlay" />

      <header
        className="shrink-0 flex items-center justify-between px-5"
        style={{
          height: 44,
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-panel)",
          zIndex: 20,
        }}
      >
        <div className="flex items-center gap-5">
          <div className="flex items-center gap-2">
            <img
              src={isDark ? "/kanbun-icon-dark.png" : "/kanbun-icon-light.png"}
              alt="Kanbun"
              className="app-brand-icon"
              style={{ transition: "opacity 0.3s" }}
            />
            <span style={{ fontSize: 12, letterSpacing: "0.2em", fontWeight: 700, color: "var(--hi)" }}>
              KANBUN
            </span>
            <span style={{ fontSize: 10, color: "var(--dim)", letterSpacing: "0.08em" }}>
              // ORCHESTRATOR
            </span>
          </div>

          <div style={{ width: 1, height: 20, background: "var(--border)" }} />

          <div className="flex gap-4" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--dim)" }}>
            <span>
              Agents{" "}
              <b className="sv" style={{ color: "var(--hi)", fontSize: 12 }}>
                {dashboard.stats.total_agents}
              </b>
            </span>
            <span>
              Running{" "}
              <b className="sv" style={{ color: "var(--hi)", fontSize: 12 }}>
                {dashboard.stats.running}
              </b>
            </span>
            <span>
              Projects{" "}
              <b className="sv" style={{ color: "var(--hi)", fontSize: 12 }}>
                {String(dashboard.projects.length).padStart(2, "0")}
              </b>
            </span>
            <span>
              Attention{" "}
              <b className="sv" style={{ color: "var(--hi)", fontSize: 12 }}>
                {dashboard.stats.needs_attention}
              </b>
            </span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="mn" style={{ fontSize: 9, color: "var(--dim)", display: "flex", gap: 10 }}>
            <span>POLL <span style={{ color: "var(--hi)" }}>{settings.dashboardPollSeconds}s</span></span>
            <span>CHAT <span style={{ color: "var(--hi)" }}>{settings.conversationPollSeconds}s</span></span>
          </div>
          {!isTauri && (
            <div className="mn" style={{ fontSize: 9, color: "var(--warn)" }}>
              PREVIEW_MODE
            </div>
          )}
          {dashboardError && (
            <div className="mn" title={dashboardError} style={{ fontSize: 9, color: "var(--err)", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              SYNC_ERROR
            </div>
          )}
          <button className="theme-toggle" onClick={() => setIsDark(!isDark)}>
            {isDark ? "☽" : "☀"}
          </button>
          <div className="flex items-center gap-1.5">
            <div className="dot dot-running blink" />
            <span style={{ fontSize: 9, letterSpacing: "0.12em", fontWeight: 700, color: "var(--hi)" }}>
              ONLINE
            </span>
          </div>
        </div>
      </header>

      <div className="flex-1 flex min-h-0">
        <nav
          className="flex flex-col items-center py-3 gap-3 shrink-0"
          style={{
            width: 48,
            borderRight: "1px solid var(--border)",
            background: "var(--bg-card)",
          }}
        >
          <NavButton active={activeView === "dashboard"} title="Dashboard" onClick={() => setActiveView("dashboard")}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
              <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
            </svg>
          </NavButton>
          <NavButton active={activeView === "connectors"} title="Connectors" onClick={() => setActiveView("connectors")}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
          </NavButton>
          <NavButton active={activeView === "settings"} title="Settings" onClick={() => setActiveView("settings")}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </NavButton>
        </nav>

        <main className="flex-1 flex flex-col overflow-hidden" style={{ background: "var(--bg)" }}>
          {activeView === "dashboard" && (
            <>
              <AttentionQueue
                items={dashboard.needs_attention}
                onItemClick={setSelectedAgentId}
                onAction={handleAttentionAction}
              />
              <section
                className="flex-1 overflow-hidden grid-bg"
                style={{
                  padding: 16,
                  position: "relative",
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                {loadingDashboard && isTauri && (
                  <p className="mn" style={{ marginBottom: 2, fontSize: 10, color: "var(--dim)" }}>
                    Loading workspace...
                  </p>
                )}
                <div className="empty-obscure-card" style={{ padding: 14, background: "var(--bg-card)", display: "grid", gap: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                    <div>
                      <p className="mn" style={{ fontSize: 10, color: "var(--dim)", marginBottom: 4 }}>
                        QUICK_START
                      </p>
                      <p style={{ fontSize: 12, fontWeight: 700, color: "var(--hi)" }}>
                        Start your first workstream
                      </p>
                    </div>
                    <button className="btn-cortex" onClick={() => setActiveView("settings")}>
                      Advanced setup
                    </button>
                  </div>

                  <p className="mn" style={{ fontSize: 10, color: "var(--dim)", margin: 0, maxWidth: 760 }}>
                    1) Pick a workspace directory, 2) Select an agent, 3) Optional name, 4) Optional permissions.
                    A default space is created automatically if needed.
                  </p>

                  <div style={{ display: "grid", gap: 9 }}>
                    <label className="mn" style={{ fontSize: 10, color: "var(--main)", display: "grid", gap: 4 }}>
                      <span style={{ color: "var(--dim)" }}>1) Workspace folder</span>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          className="btn-cortex"
                          onClick={() => void handlePickQuickWorkingDirectory()}
                          disabled={!isTauri || quickWorkstreamBusy}
                        >
                          {quickWorkstreamDraft.workingDirectory ? "Change folder" : "Select folder"}
                        </button>
                        <span
                          className="mn"
                          style={{
                            minWidth: 0,
                            color: quickWorkstreamDraft.workingDirectory ? "var(--hi)" : "var(--dim)",
                            fontSize: 11,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {quickWorkstreamDraft.workingDirectory || "No folder selected"}
                        </span>
                      </div>
                    </label>

                          <label className="mn" style={{ fontSize: 10, color: "var(--main)", display: "grid", gap: 4 }}>
                          <span style={{ color: "var(--dim)" }}>2) Agent</span>
                          <select
                        value={quickWorkstreamDraft.preset}
                        onChange={(event) =>
                          handleQuickWorkstreamDraftChange({ preset: event.currentTarget.value as AgentPresetId })
                        }
                        style={{
                          border: "1px solid var(--border)",
                          background: "var(--bg-card)",
                          color: "var(--main)",
                          padding: "6px 8px",
                          fontFamily: "var(--font-mono)",
                          fontSize: 12,
                        }}
                        disabled={!isTauri || quickWorkstreamBusy}
                      >
                        {QUICK_AGENT_PRESETS.map((preset) => (
                          <option key={preset.id} value={preset.id}>
                            {preset.label}
                          </option>
                        ))}
                      </select>
                          <span className="mn" style={{ fontSize: 10, color: "var(--dim)" }}>
                            {quickPresetHelp}
                          </span>
                        </label>

                        {quickWorkstreamDraft.preset === "http_webhook" && (
                          <>
                            <label className="mn" style={{ fontSize: 10, color: "var(--main)", display: "grid", gap: 6 }}>
                              <span style={{ color: "var(--dim)" }}>2b) Webhook endpoint (required)</span>
                              <input
                                type="text"
                                value={quickWorkstreamDraft.webhookEndpoint}
                                onChange={(event) =>
                                  handleQuickWorkstreamDraftChange({ webhookEndpoint: event.currentTarget.value })
                                }
                                placeholder={DEFAULT_WEBHOOK_ENDPOINT}
                                style={{
                                  border: "1px solid var(--border)",
                                  background: "var(--bg-card)",
                                  color: "var(--main)",
                                  padding: "6px 8px",
                                  fontFamily: "var(--font-mono)",
                                  fontSize: 12,
                                }}
                                disabled={!isTauri || quickWorkstreamBusy}
                              />
                            </label>
                            <label className="mn" style={{ fontSize: 10, color: "var(--main)", display: "grid", gap: 6 }}>
                              <span style={{ color: "var(--dim)" }}>Optional Authorization header</span>
                              <input
                                type="text"
                                value={quickWorkstreamDraft.webhookAuthHeader}
                                onChange={(event) =>
                                  handleQuickWorkstreamDraftChange({ webhookAuthHeader: event.currentTarget.value })
                                }
                                placeholder='Authorization: "Bearer TOKEN"'
                                style={{
                                  border: "1px solid var(--border)",
                                  background: "var(--bg-card)",
                                  color: "var(--main)",
                                  padding: "6px 8px",
                                  fontFamily: "var(--font-mono)",
                                  fontSize: 12,
                                }}
                                disabled={!isTauri || quickWorkstreamBusy}
                              />
                            </label>
                          </>
                        )}

                    <label className="mn" style={{ fontSize: 10, color: "var(--main)", display: "grid", gap: 4 }}>
                      <span style={{ color: "var(--dim)" }}>3) Workstream name (optional)</span>
                      <input
                        type="text"
                        value={quickWorkstreamDraft.name}
                        onChange={(event) => handleQuickWorkstreamDraftChange({ name: event.currentTarget.value })}
                        placeholder="Workstream"
                        style={{
                          border: "1px solid var(--border)",
                          background: "var(--bg-card)",
                          color: "var(--main)",
                          padding: "6px 8px",
                          fontFamily: "var(--font-mono)",
                          fontSize: 12,
                        }}
                        disabled={!isTauri || quickWorkstreamBusy}
                      />
                    </label>

                    <label className="mn" style={{ fontSize: 10, color: "var(--main)", display: "grid", gap: 4 }}>
                      <span style={{ color: "var(--dim)" }}>4) Permissions (optional)</span>
                      <textarea
                        rows={3}
                        value={quickWorkstreamDraft.permissions}
                        onChange={(event) => handleQuickWorkstreamDraftChange({ permissions: event.currentTarget.value })}
                        placeholder="e.g. --allow-write /tmp --allow-net api.example.com"
                        style={{
                          border: "1px solid var(--border)",
                          background: "var(--bg-card)",
                          color: "var(--main)",
                          padding: "6px 8px",
                          fontFamily: "var(--font-mono)",
                          fontSize: 12,
                          resize: "vertical",
                        }}
                        disabled={!isTauri || quickWorkstreamBusy}
                      />
                    </label>
                  </div>

                  <div className="flex items-center gap-2" style={{ marginTop: 4 }}>
                    <button
                      className="btn-cortex btn-fill"
                      disabled={
                        !isTauri ||
                        quickWorkstreamBusy ||
                        !quickWorkstreamDraft.workingDirectory.trim()
                      }
                      onClick={() => void handleCreateQuickWorkstream()}
                    >
                      {quickWorkstreamBusy ? "Creating..." : "Create workstream"}
                    </button>
                    {quickWorkstreamMessage && (
                      <span className="mn" style={{ fontSize: 10, color: "var(--accent)" }}>
                        {quickWorkstreamMessage}
                      </span>
                    )}
                  </div>
                  {quickWorkstreamError && (
                    <p className="mn" style={{ fontSize: 10, color: "var(--err)", marginTop: 4 }}>
                      {quickWorkstreamError}
                    </p>
                  )}
                  {!isTauri ? (
                    <p className="mn" style={{ fontSize: 10, color: "var(--warn)", marginTop: 4 }}>
                      Desktop runtime required to create workstreams.
                    </p>
                  ) : null}
                </div>
              </section>
            </>
          )}

          {activeView === "connectors" && (
            <ConnectorPanel
              isTauri={isTauri}
              connectors={connectors}
              selectedConnectorId={selectedConnectorId}
              configuredConnectorIds={Object.keys(connectorConfigs)}
              draft={connectorDrafts[selectedConnectorId] ?? EMPTY_CONNECTOR_DRAFT}
              items={selectedConnectorItems}
              busyState={selectedConnectorBusy}
              message={connectorMessage}
              error={connectorError}
              onSelectConnector={setSelectedConnectorId}
              onDraftChange={(patch) => handleConnectorDraftChange(selectedConnectorId, patch)}
              onSave={() => void handleSaveConnector(selectedConnectorId)}
              onSync={() => void handleSyncConnector(selectedConnectorId)}
              onRefresh={() => void refreshConnectors()}
              onDelete={(itemId) => void handleDeleteConnectorItem(selectedConnectorId, itemId)}
            />
          )}

          {activeView === "settings" && (
            <section className="flex-1 grid-bg overflow-y-auto" style={{ padding: 16 }}>
              <div style={{ maxWidth: 760, margin: "0 auto", display: "grid", gap: 12 }}>
                <div
                  style={{
                    border: "1px solid var(--border)",
                    background: "var(--bg-card)",
                    padding: 12,
                  }}
                >
                  <p className="mn" style={{ fontSize: 10, color: "var(--dim)", marginBottom: 6 }}>
                    WORKSPACE_SETUP
                  </p>
                  <p style={{ fontSize: 13, fontWeight: 700, color: "var(--hi)", marginBottom: 10 }}>
                    Create projects and agents
                  </p>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                      gap: 10,
                    }}
                  >
                    <div
                      style={{
                        border: "1px solid var(--border)",
                        background: "var(--bg-panel)",
                        padding: 10,
                      }}
                    >
                      <p className="hdr" style={{ color: "var(--dim)", marginBottom: 8 }}>
                        New Project
                      </p>
                      <div style={{ display: "grid", gap: 8 }}>
                        <label className="mn" style={{ fontSize: 10, color: "var(--main)", display: "grid", gap: 6 }}>
                          Project name
                          <input
                            type="text"
                            value={projectDraft.name}
                            onChange={(event) => handleProjectDraftChange({ name: event.currentTarget.value })}
                            placeholder="Kanbun Core"
                            style={{
                              border: "1px solid var(--border)",
                              background: "var(--bg-card)",
                              color: "var(--main)",
                              padding: "6px 8px",
                              fontFamily: "var(--font-mono)",
                              fontSize: 12,
                            }}
                            disabled={!isTauri || projectBusy}
                          />
                        </label>
                        <label className="mn" style={{ fontSize: 10, color: "var(--main)", display: "grid", gap: 6 }}>
                          Color
                          <input
                            type="color"
                            value={projectDraft.color}
                            onChange={(event) => handleProjectDraftChange({ color: event.currentTarget.value })}
                            style={{
                              border: "1px solid var(--border)",
                              background: "var(--bg-card)",
                              color: "var(--main)",
                              height: 32,
                              padding: 2,
                            }}
                            disabled={!isTauri || projectBusy}
                          />
                        </label>
                      </div>
                      <div className="flex items-center gap-2" style={{ marginTop: 10 }}>
                        <button
                          className="btn-cortex btn-fill"
                          disabled={!isTauri || projectBusy || !projectDraft.name.trim()}
                          onClick={() => void handleCreateProject()}
                        >
                          {projectBusy ? "Creating..." : "Create project"}
                        </button>
                        {projectMessage && (
                          <span className="mn" style={{ fontSize: 10, color: "var(--accent)" }}>
                            {projectMessage}
                          </span>
                        )}
                      </div>
                      {projectError && (
                        <p className="mn" style={{ fontSize: 10, color: "var(--err)", marginTop: 8 }}>
                          {projectError}
                        </p>
                      )}
                    </div>

                    <div
                      style={{
                        border: "1px solid var(--border)",
                        background: "var(--bg-panel)",
                        padding: 10,
                      }}
                    >
                      <p className="hdr" style={{ color: "var(--dim)", marginBottom: 8 }}>
                        New Workstream
                      </p>
                      <p className="mn" style={{ fontSize: 9, color: "var(--dim)", marginBottom: 8 }}>
                        Each workstream maps to one agent session.
                      </p>
                      <div style={{ display: "grid", gap: 8 }}>
                        <label className="mn" style={{ fontSize: 10, color: "var(--main)", display: "grid", gap: 6 }}>
                          Agent name
                          <input
                            type="text"
                            value={agentDraft.name}
                            onChange={(event) => handleAgentDraftChange({ name: event.currentTarget.value })}
                            placeholder="Kanbun Builder"
                            style={{
                              border: "1px solid var(--border)",
                              background: "var(--bg-card)",
                              color: "var(--main)",
                              padding: "6px 8px",
                              fontFamily: "var(--font-mono)",
                              fontSize: 12,
                            }}
                            disabled={!isTauri || agentBusy}
                          />
                        </label>
                        <label className="mn" style={{ fontSize: 10, color: "var(--main)", display: "grid", gap: 6 }}>
                          Project
                          <select
                            value={agentDraft.projectId}
                            onChange={(event) => handleAgentDraftChange({ projectId: event.currentTarget.value })}
                            style={{
                              border: "1px solid var(--border)",
                              background: "var(--bg-card)",
                              color: "var(--main)",
                              padding: "6px 8px",
                              fontFamily: "var(--font-mono)",
                              fontSize: 12,
                            }}
                            disabled={!isTauri || agentBusy || dashboard.projects.length === 0}
                          >
                            {dashboard.projects.length === 0 ? (
                              <option value="">Create a project first</option>
                            ) : (
                              dashboard.projects.map((projectGroup) => (
                                <option key={projectGroup.project.id} value={projectGroup.project.id}>
                                  {projectGroup.project.name}
                                </option>
                              ))
                            )}
                          </select>
                        </label>
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "1fr 1fr",
                            gap: 8,
                          }}
                        >
                          <label className="mn" style={{ fontSize: 10, color: "var(--main)", display: "grid", gap: 6 }}>
                            Kind
                            <select
                              value={agentDraft.kind}
                              onChange={(event) =>
                                handleAgentDraftChange({ kind: event.currentTarget.value as AgentKind })
                              }
                              style={{
                                border: "1px solid var(--border)",
                                background: "var(--bg-card)",
                                color: "var(--main)",
                                padding: "6px 8px",
                                fontFamily: "var(--font-mono)",
                                fontSize: 12,
                              }}
                              disabled={!isTauri || agentBusy}
                            >
                              <option value="terminal">terminal</option>
                              <option value="api">api</option>
                              <option value="script">script</option>
                            </select>
                          </label>
                          <label className="mn" style={{ fontSize: 10, color: "var(--main)", display: "grid", gap: 6 }}>
                            Function tag
                            <input
                              type="text"
                              value={agentDraft.functionTag}
                              onChange={(event) => handleAgentDraftChange({ functionTag: event.currentTarget.value })}
                              placeholder="engineering"
                              style={{
                                border: "1px solid var(--border)",
                                background: "var(--bg-card)",
                                color: "var(--main)",
                                padding: "6px 8px",
                                fontFamily: "var(--font-mono)",
                                fontSize: 12,
                              }}
                              disabled={!isTauri || agentBusy}
                            />
                          </label>
                        </div>
                        <label className="mn" style={{ fontSize: 10, color: "var(--main)", display: "grid", gap: 6 }}>
                          Working directory (optional)
                          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 6 }}>
                            <input
                              type="text"
                              value={agentDraft.workingDirectory}
                              onChange={(event) =>
                                handleAgentDraftChange({ workingDirectory: event.currentTarget.value })
                              }
                              placeholder="~/projects/kanbun"
                              style={{
                                border: "1px solid var(--border)",
                                background: "var(--bg-card)",
                                color: "var(--main)",
                                padding: "6px 8px",
                                fontFamily: "var(--font-mono)",
                                fontSize: 12,
                              }}
                              disabled={!isTauri || agentBusy}
                            />
                            <button
                              type="button"
                              className="btn-cortex"
                              onClick={() => void handlePickWorkingDirectory()}
                              disabled={!isTauri || agentBusy}
                            >
                              Browse…
                            </button>
                          </div>
                        </label>
                        <label className="mn" style={{ fontSize: 10, color: "var(--main)", display: "grid", gap: 6 }}>
                          Initial instruction (optional)
                          <textarea
                            value={agentDraft.initialInstruction}
                            onChange={(event) =>
                              handleAgentDraftChange({ initialInstruction: event.currentTarget.value })
                            }
                            placeholder="Start by scanning the repo and summarizing open tasks."
                            style={{
                              border: "1px solid var(--border)",
                              background: "var(--bg-card)",
                              color: "var(--main)",
                              padding: "8px 10px",
                              fontFamily: "var(--font-mono)",
                              fontSize: 11,
                              minHeight: 68,
                              resize: "vertical",
                            }}
                            disabled={!isTauri || agentBusy}
                          />
                        </label>
                        <label className="mn" style={{ fontSize: 10, color: "var(--main)", display: "grid", gap: 6 }}>
                          Agent preset
                          <select
                            value={agentDraft.preset}
                            onChange={(event) => handleApplyAgentPreset(event.currentTarget.value as AgentPresetId)}
                            style={{
                              border: "1px solid var(--border)",
                              background: "var(--bg-card)",
                              color: "var(--main)",
                              padding: "6px 8px",
                              fontFamily: "var(--font-mono)",
                              fontSize: 12,
                            }}
                            disabled={!isTauri || agentBusy}
                          >
                            {AGENT_PRESETS.map((preset) => (
                              <option key={preset.id} value={preset.id}>
                                {preset.label}
                              </option>
                            ))}
                          </select>
                          <span className="mn" style={{ fontSize: 9, color: "var(--dim)" }}>
                            {
                              AGENT_PRESETS.find((preset) => preset.id === agentDraft.preset)?.description ??
                              AGENT_PRESETS[0].description
                            }
                          </span>
                        </label>
                        <label className="mn" style={{ fontSize: 10, color: "var(--main)", display: "grid", gap: 6 }}>
                          Adapter
                          <select
                            value={agentDraft.adapterType}
                            onChange={(event) =>
                              handleAgentDraftChange({
                                adapterType: event.currentTarget.value as AdapterType,
                                preset: "custom",
                              })
                            }
                            style={{
                              border: "1px solid var(--border)",
                              background: "var(--bg-card)",
                              color: "var(--main)",
                              padding: "6px 8px",
                              fontFamily: "var(--font-mono)",
                              fontSize: 12,
                            }}
                            disabled={!isTauri || agentBusy}
                          >
                            <option value="mock">mock</option>
                            <option value="claude_code">claude_code</option>
                            <option value="process">process</option>
                            <option value="http_webhook">http_webhook</option>
                          </select>
                        </label>
                        {agentDraft.adapterType === "claude_code" && (
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: "1fr 1fr",
                              gap: 8,
                            }}
                          >
                            <label className="mn" style={{ fontSize: 10, color: "var(--main)", display: "grid", gap: 6 }}>
                              Session prefix
                              <input
                                type="text"
                                value={agentDraft.sessionPrefix}
                                onChange={(event) =>
                                  handleAgentDraftChange({ sessionPrefix: event.currentTarget.value })
                                }
                                placeholder="kanbun"
                                style={{
                                  border: "1px solid var(--border)",
                                  background: "var(--bg-card)",
                                  color: "var(--main)",
                                  padding: "6px 8px",
                                  fontFamily: "var(--font-mono)",
                                  fontSize: 12,
                                }}
                                disabled={!isTauri || agentBusy}
                              />
                            </label>
                            <label className="mn" style={{ fontSize: 10, color: "var(--main)", display: "grid", gap: 6 }}>
                              Claude command
                              <input
                                type="text"
                                value={agentDraft.claudeCommand}
                                onChange={(event) =>
                                  handleAgentDraftChange({ claudeCommand: event.currentTarget.value })
                                }
                                placeholder="claude"
                                style={{
                                  border: "1px solid var(--border)",
                                  background: "var(--bg-card)",
                                  color: "var(--main)",
                                  padding: "6px 8px",
                                  fontFamily: "var(--font-mono)",
                                  fontSize: 12,
                                }}
                                disabled={!isTauri || agentBusy}
                              />
                            </label>
                          </div>
                        )}
                        {agentDraft.adapterType === "process" && (
                          <label
                            className="mn"
                            style={{ fontSize: 10, color: "var(--main)", display: "grid", gap: 6 }}
                          >
                            Process command
                            <input
                              type="text"
                              value={agentDraft.processCommand}
                              onChange={(event) =>
                                handleAgentDraftChange({ processCommand: event.currentTarget.value })
                              }
                              placeholder="codex"
                              style={{
                                border: "1px solid var(--border)",
                                background: "var(--bg-card)",
                                color: "var(--main)",
                                padding: "6px 8px",
                                fontFamily: "var(--font-mono)",
                                fontSize: 12,
                              }}
                              disabled={!isTauri || agentBusy}
                            />
                          </label>
                        )}
                        {agentDraft.adapterType === "http_webhook" && (
                          <>
                            <label className="mn" style={{ fontSize: 10, color: "var(--main)", display: "grid", gap: 6 }}>
                              Webhook endpoint (required)
                              <input
                                type="text"
                                value={agentDraft.webhookEndpoint}
                                onChange={(event) =>
                                  handleAgentDraftChange({ webhookEndpoint: event.currentTarget.value })
                                }
                                placeholder={DEFAULT_WEBHOOK_ENDPOINT}
                                style={{
                                  border: "1px solid var(--border)",
                                  background: "var(--bg-card)",
                                  color: "var(--main)",
                                  padding: "6px 8px",
                                  fontFamily: "var(--font-mono)",
                                  fontSize: 12,
                                }}
                                disabled={!isTauri || agentBusy}
                              />
                            </label>
                            <label className="mn" style={{ fontSize: 10, color: "var(--main)", display: "grid", gap: 6 }}>
                              Authorization header (optional)
                              <input
                                type="text"
                                value={agentDraft.webhookAuthHeader}
                                onChange={(event) =>
                                  handleAgentDraftChange({ webhookAuthHeader: event.currentTarget.value })
                                }
                                placeholder='Authorization: "Bearer TOKEN"'
                                style={{
                                  border: "1px solid var(--border)",
                                  background: "var(--bg-card)",
                                  color: "var(--main)",
                                  padding: "6px 8px",
                                  fontFamily: "var(--font-mono)",
                                  fontSize: 12,
                                }}
                                disabled={!isTauri || agentBusy}
                              />
                            </label>
                          </>
                        )}
                      </div>
                      <div className="flex items-center gap-2" style={{ marginTop: 10 }}>
                        <button
                          className="btn-cortex btn-fill"
                          disabled={
                            !isTauri ||
                            agentBusy ||
                            !agentDraft.name.trim() ||
                            !agentDraft.projectId
                          }
                          onClick={() => void handleCreateAgent()}
                        >
                          {agentBusy ? "Creating..." : "Create workstream"}
                        </button>
                        {agentMessage && (
                          <span className="mn" style={{ fontSize: 10, color: "var(--accent)" }}>
                            {agentMessage}
                          </span>
                        )}
                      </div>
                      {agentError && (
                        <p className="mn" style={{ fontSize: 10, color: "var(--err)", marginTop: 8 }}>
                          {agentError}
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    border: "1px solid var(--border)",
                    background: "var(--bg-card)",
                    padding: 12,
                  }}
                >
                  <p className="mn" style={{ fontSize: 10, color: "var(--dim)", marginBottom: 6 }}>
                    DATA_BACKUP
                  </p>
                  <p style={{ fontSize: 13, fontWeight: 700, color: "var(--hi)", marginBottom: 8 }}>
                    Export and import local database
                  </p>
                  <p className="mn" style={{ fontSize: 10, color: "var(--main)", marginBottom: 10 }}>
                    Export saves a full local snapshot. Import replaces current local app data.
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      className="btn-cortex"
                      onClick={() => void handleExportDatabaseSnapshot()}
                      disabled={!isTauri || backupBusy !== "idle"}
                    >
                      {backupBusy === "exporting" ? "Exporting..." : "Export DB"}
                    </button>
                    <button
                      className="btn-cortex"
                      onClick={() => void handleImportDatabaseSnapshot()}
                      disabled={!isTauri || backupBusy !== "idle"}
                    >
                      {backupBusy === "importing" ? "Importing..." : "Import DB"}
                    </button>
                    {backupMessage && (
                      <span className="mn" style={{ fontSize: 10, color: "var(--accent)" }}>
                        {backupMessage}
                      </span>
                    )}
                  </div>
                  {backupError && (
                    <p className="mn" style={{ fontSize: 10, color: "var(--err)", marginTop: 8 }}>
                      {backupError}
                    </p>
                  )}
                </div>

                <div
                  style={{
                    border: "1px solid var(--border)",
                    background: "var(--bg-card)",
                    padding: 12,
                  }}
                >
                  <p className="mn" style={{ fontSize: 10, color: "var(--dim)", marginBottom: 6 }}>
                    PROJECT_CONTEXT
                  </p>
                  <p style={{ fontSize: 13, fontWeight: 700, color: "var(--hi)", marginBottom: 10 }}>
                    Shared context documents per project
                  </p>
                  <div style={{ display: "grid", gap: 10 }}>
                    <label className="mn" style={{ fontSize: 10, color: "var(--main)", display: "grid", gap: 6 }}>
                      Project
                      <select
                        value={contextProjectId}
                        onChange={(event) => {
                          setContextProjectId(event.currentTarget.value);
                          setContextMessage(null);
                          setContextError(null);
                        }}
                        style={{
                          border: "1px solid var(--border)",
                          background: "var(--bg-panel)",
                          color: "var(--main)",
                          padding: "6px 8px",
                          fontFamily: "var(--font-mono)",
                          fontSize: 12,
                        }}
                        disabled={!isTauri || dashboard.projects.length === 0}
                      >
                        {dashboard.projects.length === 0 ? (
                          <option value="">Create a project first</option>
                        ) : (
                          dashboard.projects.map((projectGroup) => (
                            <option key={projectGroup.project.id} value={projectGroup.project.id}>
                              {projectGroup.project.name}
                            </option>
                          ))
                        )}
                      </select>
                    </label>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                        gap: 10,
                      }}
                    >
                      <div
                        style={{
                          border: "1px solid var(--border)",
                          background: "var(--bg-panel)",
                          minHeight: 220,
                          maxHeight: 300,
                          overflowY: "auto",
                        }}
                      >
                        {selectedContextDocs.length === 0 ? (
                          <p className="mn" style={{ fontSize: 10, color: "var(--dim)", padding: 10 }}>
                            {contextLoading ? "Loading context..." : "No context docs yet."}
                          </p>
                        ) : (
                          selectedContextDocs.map((doc) => (
                            <button
                              key={doc.id}
                              onClick={() => handleSelectContextDoc(doc.id)}
                              style={{
                                width: "100%",
                                textAlign: "left",
                                padding: "8px 10px",
                                border: "none",
                                borderBottom: "1px solid var(--border)",
                                background:
                                  contextSelectedDocId === doc.id ? "var(--bg-card)" : "transparent",
                                color: "var(--main)",
                                cursor: "pointer",
                              }}
                            >
                              <div className="mn" style={{ fontSize: 10, color: "var(--hi)" }}>
                                {doc.title}
                              </div>
                              <div className="mn" style={{ fontSize: 9, color: "var(--dim)", marginTop: 2 }}>
                                {new Date(doc.updated_at).toLocaleString()}
                              </div>
                            </button>
                          ))
                        )}
                      </div>

                      <div
                        style={{
                          border: "1px solid var(--border)",
                          background: "var(--bg-panel)",
                          padding: 10,
                          display: "grid",
                          gap: 8,
                        }}
                      >
                        <label className="mn" style={{ fontSize: 10, color: "var(--main)", display: "grid", gap: 6 }}>
                          Title
                          <input
                            type="text"
                            value={contextDraft.title}
                            onChange={(event) =>
                              setContextDraft((prev) => ({ ...prev, title: event.currentTarget.value }))
                            }
                            placeholder="Engineering brief"
                            style={{
                              border: "1px solid var(--border)",
                              background: "var(--bg-card)",
                              color: "var(--main)",
                              padding: "6px 8px",
                              fontFamily: "var(--font-mono)",
                              fontSize: 12,
                            }}
                            disabled={!isTauri || contextLoading}
                          />
                        </label>
                        <label className="mn" style={{ fontSize: 10, color: "var(--main)", display: "grid", gap: 6 }}>
                          Content (markdown/plaintext)
                          <textarea
                            value={contextDraft.content}
                            onChange={(event) =>
                              setContextDraft((prev) => ({ ...prev, content: event.currentTarget.value }))
                            }
                            placeholder="Add project-level goals, constraints, key links, and operating guidance."
                            style={{
                              border: "1px solid var(--border)",
                              background: "var(--bg-card)",
                              color: "var(--main)",
                              padding: "8px 10px",
                              fontFamily: "var(--font-mono)",
                              fontSize: 11,
                              minHeight: 150,
                              resize: "vertical",
                            }}
                            disabled={!isTauri || contextLoading}
                          />
                        </label>
                        <div className="flex items-center gap-2">
                          <button
                            className="btn-cortex"
                            onClick={handleCreateContextDoc}
                            disabled={!isTauri || contextSaving || contextDeleting}
                          >
                            New doc
                          </button>
                          <button
                            className="btn-cortex btn-fill"
                            onClick={() => void handleSaveContextDoc()}
                            disabled={!isTauri || contextSaving || contextDeleting || !contextProjectId}
                          >
                            {contextSaving ? "Saving..." : "Save doc"}
                          </button>
                          <button
                            className="btn-cortex"
                            onClick={() => void handleDeleteContextDoc()}
                            disabled={!isTauri || contextSaving || contextDeleting || !contextSelectedDocId}
                          >
                            {contextDeleting ? "Deleting..." : "Delete"}
                          </button>
                          <button
                            className="btn-cortex"
                            onClick={() => void refreshProjectContextDocs(contextProjectId)}
                            disabled={!isTauri || contextLoading || !contextProjectId}
                          >
                            {contextLoading ? "Refreshing..." : "Refresh"}
                          </button>
                          {contextMessage && (
                            <span className="mn" style={{ fontSize: 10, color: "var(--accent)" }}>
                              {contextMessage}
                            </span>
                          )}
                        </div>
                        {contextError && (
                          <p className="mn" style={{ fontSize: 10, color: "var(--err)" }}>
                            {contextError}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    border: "1px solid var(--border)",
                    background: "var(--bg-card)",
                    padding: 12,
                  }}
                >
                  <p className="mn" style={{ fontSize: 10, color: "var(--dim)", marginBottom: 6 }}>
                    GENERAL_SETTINGS
                  </p>
                  <p style={{ fontSize: 13, fontWeight: 700, color: "var(--hi)", marginBottom: 10 }}>
                    Configure refresh behavior
                  </p>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                      gap: 10,
                    }}
                  >
                    <label className="mn" style={{ fontSize: 10, color: "var(--main)", display: "grid", gap: 6 }}>
                      Dashboard refresh (seconds)
                      <input
                        type="number"
                        min={MIN_POLL_SECONDS}
                        max={MAX_POLL_SECONDS}
                        value={settingsDraft.dashboardPollSeconds}
                        onChange={(event) =>
                          handleSettingsFieldChange("dashboardPollSeconds", event.currentTarget.valueAsNumber)
                        }
                        style={{
                          border: "1px solid var(--border)",
                          background: "var(--bg-panel)",
                          color: "var(--main)",
                          padding: "6px 8px",
                          fontFamily: "var(--font-mono)",
                          fontSize: 12,
                        }}
                      />
                    </label>
                    <label className="mn" style={{ fontSize: 10, color: "var(--main)", display: "grid", gap: 6 }}>
                      Conversation refresh (seconds)
                      <input
                        type="number"
                        min={MIN_POLL_SECONDS}
                        max={MAX_POLL_SECONDS}
                        value={settingsDraft.conversationPollSeconds}
                        onChange={(event) =>
                          handleSettingsFieldChange("conversationPollSeconds", event.currentTarget.valueAsNumber)
                        }
                        style={{
                          border: "1px solid var(--border)",
                          background: "var(--bg-panel)",
                          color: "var(--main)",
                          padding: "6px 8px",
                          fontFamily: "var(--font-mono)",
                          fontSize: 12,
                        }}
                      />
                    </label>
                  </div>
                  <div className="flex items-center gap-2" style={{ marginTop: 12 }}>
                    <button
                      className="btn-cortex btn-fill"
                      disabled={!hasUnsavedSettings}
                      onClick={handleSaveSettings}
                    >
                      Save settings
                    </button>
                    <button className="btn-cortex" onClick={handleResetSettings}>
                      Reset defaults
                    </button>
                    {settingsMessage && (
                      <span className="mn" style={{ fontSize: 10, color: "var(--accent)" }}>
                        {settingsMessage}
                      </span>
                    )}
                  </div>
                </div>

                <div
                  style={{
                    border: "1px solid var(--border)",
                    background: "var(--bg-card)",
                    padding: 12,
                  }}
                >
                  <p className="mn" style={{ fontSize: 10, color: "var(--dim)", marginBottom: 8 }}>
                    RUNTIME
                  </p>
                  <div
                    className="mn"
                    style={{
                      fontSize: 10,
                      color: "var(--main)",
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                      gap: 8,
                    }}
                  >
                    <div>Mode: {isTauri ? "Desktop runtime" : "Browser preview"}</div>
                    <div>Dashboard polling: every {settings.dashboardPollSeconds}s</div>
                    <div>Conversation polling: every {settings.conversationPollSeconds}s</div>
                    <div>Dev URL: http://127.0.0.1:3002</div>
                    <div>Database file: kanbun.db</div>
                    <div>Configured connectors: {Object.keys(connectorConfigs).length}</div>
                  </div>
                </div>
              </div>
            </section>
          )}
        </main>

        {activeView === "dashboard" && selectedAgent && selectedProject && (
          <AgentDetailPanel
            summary={selectedAgent}
            runs={selectedAgentRuns}
            adapterConfig={selectedAdapterConfig}
            adapterHealth={selectedAdapterHealth}
            adapterHealthLoading={selectedAdapterHealthLoading}
            adapterRestartBusy={selectedAdapterRestartBusy}
            projectName={selectedProject.project.name}
            projectColor={selectedProject.project.color}
            messages={messagesByAgent[selectedAgent.agent.id] ?? selectedAgentDetail?.messages ?? []}
            conversationHasMore={selectedConversationHasMore}
            conversationLoadingOlder={selectedConversationLoadingOlder}
            onClose={() => setSelectedAgentId(null)}
            onSendMessage={handleSendMessage}
            onLoadOlderConversation={loadOlderConversation}
            onRefreshAdapterHealth={() => void refreshAdapterHealth(selectedAgent.agent.id)}
            onRestartAdapter={() => void handleRestartAdapter(selectedAgent.agent.id)}
            onSaveAdapterConfig={handleSaveAdapterConfig}
          />
        )}
      </div>
    </div>
  );
}

function NavButton({
  children,
  active,
  title,
  onClick,
}: {
  children: React.ReactNode;
  active?: boolean;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      style={{
        width: 28,
        height: 28,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        border: active ? "1px solid var(--accent)" : "none",
        color: active ? "var(--accent)" : "var(--dim)",
        background: active ? "var(--bg-panel)" : "transparent",
      }}
    >
      {children}
    </button>
  );
}
