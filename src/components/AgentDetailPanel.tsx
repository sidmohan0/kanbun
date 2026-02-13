import { useState } from "react";
import type {
  AdapterConfig,
  AdapterHealth,
  AgentSummary,
  Run,
  FileChange,
  Message,
  MessageKind,
} from "@/types";
import { StatusBadge } from "./StatusBadge";
import { ConversationThread } from "./ConversationThread";

const autonomyLabels: Record<string, string> = {
  manual: "Manual — requires approval for everything",
  draft_only: "Draft Only — produces output, waits for review",
  supervised: "Supervised — executes, flags for post-review",
  autonomous: "Autonomous — runs freely, reports results",
};

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
  });
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

type TabId = "chat" | "overview";

export function AgentDetailPanel({
  summary,
  runs,
  adapterConfig,
  adapterHealth,
  adapterHealthLoading,
  adapterRestartBusy,
  projectName,
  projectColor,
  messages,
  onClose,
  onSendMessage,
  onRefreshAdapterHealth,
  onRestartAdapter,
}: {
  summary: AgentSummary;
  runs: Run[];
  adapterConfig: AdapterConfig | null;
  adapterHealth: AdapterHealth | null;
  adapterHealthLoading: boolean;
  adapterRestartBusy: boolean;
  projectName: string;
  projectColor: string;
  messages: Message[];
  onClose: () => void;
  onSendMessage: (agentId: string, kind: MessageKind, content: string) => void;
  onRefreshAdapterHealth: () => void;
  onRestartAdapter: () => void;
}) {
  const { agent, recent_run } = summary;
  const [activeTab, setActiveTab] = useState<TabId>("chat");
  const latestRun = runs[0] ?? recent_run;
  const completedRuns = runs.filter((run) => run.status === "completed").length;
  const terminalRuns = runs.filter((run) => run.status !== "in_progress").length;
  const successRate = terminalRuns > 0 ? `${((completedRuns / terminalRuns) * 100).toFixed(1)}%` : "—";
  const sendInstruction = (content: string) => onSendMessage(agent.id, "instruction", content);

  return (
    <aside
      className="shrink-0 flex flex-col"
      style={{
        width: 380,
        background: "var(--bg-card)",
        borderLeft: "1px solid var(--border)",
        boxShadow: "-8px 0 24px -12px var(--shadow)",
      }}
    >
      {/* Header */}
      <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", background: "var(--bg-panel)" }}>
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-1.5">
              <span style={{ fontWeight: 700, fontSize: 13, color: "var(--hi)", letterSpacing: "0.06em" }}>
                {agent.name.toUpperCase().replace(/\s+/g, "_")}
              </span>
              <StatusBadge status={agent.status} />
            </div>
            <div className="mn flex items-center gap-1.5" style={{ fontSize: 9, color: "var(--dim)", marginTop: 2 }}>
              <div style={{ width: 6, height: 6, background: projectColor }} />
              {projectName} · {agent.function_tag}
            </div>
          </div>
          <button
            onClick={onClose}
            className="btn-cortex"
            style={{ padding: "2px 6px", fontSize: 11 }}
          >
            ✕
          </button>
        </div>
      </div>

      {/* Stats */}
      <div
        style={{
          padding: "8px 14px",
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 8,
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div style={{ padding: 8, border: "1px solid var(--border)", background: "var(--bg-panel)" }}>
          <div style={{ fontSize: 9, color: "var(--dim)", textTransform: "uppercase", marginBottom: 2 }}>
            Success Rate
          </div>
          <div className="sv" style={{ fontSize: 18, color: "var(--hi)" }}>
            {successRate}
          </div>
        </div>
        <div style={{ padding: 8, border: "1px solid var(--border)", background: "var(--bg-panel)" }}>
          <div style={{ fontSize: 9, color: "var(--dim)", textTransform: "uppercase", marginBottom: 2 }}>
            Files Changed
          </div>
          <div className="sv" style={{ fontSize: 18, color: "var(--hi)" }}>
            {latestRun?.file_changes.length || 0}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex" style={{ borderBottom: "1px solid var(--border)" }}>
        <button
          className={`tab-cortex ${activeTab === "chat" ? "active" : ""}`}
          onClick={() => setActiveTab("chat")}
        >
          Chat
          {messages.filter((m) => m.kind !== "heartbeat").length > 0 && (
            <span className="mn" style={{ marginLeft: 4, fontSize: 9, color: "var(--dim)" }}>
              ({messages.filter((m) => m.kind !== "heartbeat").length})
            </span>
          )}
        </button>
        <button
          className={`tab-cortex ${activeTab === "overview" ? "active" : ""}`}
          onClick={() => setActiveTab("overview")}
        >
          Overview
        </button>
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0">
        {activeTab === "chat" ? (
          <ConversationThread
            agentId={agent.id}
            messages={messages}
            onSendMessage={(kind, content) => onSendMessage(agent.id, kind, content)}
          />
        ) : (
          <div className="overflow-y-auto h-full" style={{ padding: "12px 14px" }}>
            {/* Config */}
            <SectionTitle>Configuration</SectionTitle>
            <div style={{ marginBottom: 16 }}>
              <ConfigRow label="Autonomy" value={autonomyLabels[agent.config.autonomy_level] || agent.config.autonomy_level} />
              {agent.working_directory && <ConfigRow label="Directory" value={agent.working_directory} mono />}
              {agent.config.schedule && <ConfigRow label="Schedule" value={agent.config.schedule} mono />}
              <ConfigRow label="Function" value={agent.function_tag} />
              <ConfigRow label="Adapter" value={adapterConfig?.adapter_type || "not configured"} mono />
              {adapterConfig?.session_name && <ConfigRow label="Session" value={adapterConfig.session_name} mono />}
              {adapterConfig?.endpoint && <ConfigRow label="Endpoint" value={adapterConfig.endpoint} mono />}
              {adapterConfig?.command && <ConfigRow label="Command/CWD" value={adapterConfig.command} mono />}
            </div>

            <SectionTitle>Adapter Health</SectionTitle>
            <div
              style={{
                marginBottom: 16,
                padding: 8,
                border: "1px solid var(--border)",
                background: "var(--bg-panel)",
              }}
            >
              <ConfigRow
                label="Connected"
                value={
                  adapterHealth
                    ? adapterHealth.connected
                      ? "yes"
                      : "no"
                    : "unknown"
                }
              />
              <ConfigRow
                label="Session"
                value={
                  adapterHealth
                    ? adapterHealth.session_active
                      ? "active"
                      : "inactive"
                    : "unknown"
                }
              />
              {adapterHealth?.last_heartbeat && (
                <ConfigRow label="Heartbeat" value={formatDate(adapterHealth.last_heartbeat)} />
              )}
              {adapterHealth?.details && (
                <p className="mn" style={{ fontSize: 9, color: "var(--dim)", marginTop: 6, whiteSpace: "pre-wrap" }}>
                  {adapterHealth.details}
                </p>
              )}
              <div className="flex gap-1.5" style={{ marginTop: 8 }}>
                <ActionBtn
                  label={adapterHealthLoading ? "Refreshing..." : "Refresh"}
                  onClick={onRefreshAdapterHealth}
                  disabled={adapterHealthLoading || adapterRestartBusy}
                />
                <ActionBtn
                  label={adapterRestartBusy ? "Restarting..." : "Restart Adapter"}
                  onClick={onRestartAdapter}
                  disabled={adapterRestartBusy}
                />
              </div>
            </div>

            {/* Runs */}
            <SectionTitle>Recent Runs</SectionTitle>
            <div style={{ marginBottom: 16 }}>
              {runs.length === 0 ? (
                <p className="sv" style={{ fontSize: 10, color: "var(--dim)" }}>No runs yet</p>
              ) : (
                runs.map((run) => <RunCard key={run.id} run={run} />)
              )}
            </div>

            {/* File changes */}
            {latestRun && latestRun.file_changes.length > 0 && (
              <>
                <SectionTitle>File Changes ({latestRun.file_changes.length})</SectionTitle>
                <div style={{ marginBottom: 16 }}>
                  {latestRun.file_changes.map((fc, i) => (
                    <FileChangeRow key={i} change={fc} />
                  ))}
                </div>
              </>
            )}

            {/* Outputs */}
            {latestRun && latestRun.outputs.length > 0 && (
              <>
                <SectionTitle>Outputs</SectionTitle>
                <div style={{ marginBottom: 16 }}>
                  {latestRun.outputs.map((output, i) => (
                    <div
                      key={i}
                      style={{
                        padding: 8,
                        border: "1px solid var(--border)",
                        background: "var(--bg-panel)",
                        marginBottom: 4,
                      }}
                    >
                      <div className="flex items-center gap-2" style={{ marginBottom: 2 }}>
                        <span className="mn hdr" style={{ color: "var(--dim)" }}>{output.kind}</span>
                        <span className="mn" style={{ fontSize: 9, color: "var(--ghost)" }}>
                          {formatTime(output.timestamp)}
                        </span>
                      </div>
                      <p className="mn" style={{ fontSize: 10, color: "var(--main)", whiteSpace: "pre-wrap", lineHeight: 1.4 }}>
                        {output.content}
                      </p>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Actions */}
            <SectionTitle>Actions</SectionTitle>
            <div className="flex flex-wrap gap-1.5">
              {agent.status === "errored" && (
                <ActionBtn
                  label="Retry"
                  fill
                  onClick={() => sendInstruction("Retry the last failed task and report the result.")}
                />
              )}
              {agent.status === "running" && (
                <ActionBtn label="Pause" onClick={() => onSendMessage(agent.id, "pause", "")} />
              )}
              {agent.status === "idle" && (
                <ActionBtn
                  label="Run Now"
                  fill
                  onClick={() => sendInstruction("Start the next highest-priority task now.")}
                />
              )}
              {latestRun?.status === "needs_review" && (
                <>
                  <ActionBtn
                    label="Approve"
                    fill
                    onClick={() =>
                      sendInstruction("Approved. Proceed with completion steps and summarize what changed.")
                    }
                  />
                  <ActionBtn
                    label="Reject"
                    onClick={() =>
                      sendInstruction("Rejected. Rework the output based on review feedback and resubmit.")
                    }
                  />
                </>
              )}
              <ActionBtn label="View Logs" onClick={() => onSendMessage(agent.id, "status_request", "")} />
              <ActionBtn label="Checkpoint" onClick={() => sendInstruction("Provide a concise status checkpoint.")} />
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

/* ── Subcomponents ─────────────────────────────────────────────────────────── */

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="hdr" style={{ color: "var(--dim)", marginBottom: 6 }}>
      {children}
    </h3>
  );
}

function ConfigRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start gap-2" style={{ marginBottom: 3 }}>
      <span className="mn" style={{ fontSize: 9, color: "var(--dim)", flexShrink: 0, width: 70 }}>{label}</span>
      <span className={mono ? "mn" : ""} style={{ fontSize: 10, color: "var(--main)" }}>{value}</span>
    </div>
  );
}

const runStripe: Record<string, string> = {
  in_progress: "var(--accent)",
  completed: "var(--done)",
  failed: "var(--err)",
  needs_review: "var(--warn)",
};

function RunCard({ run }: { run: Run }) {
  return (
    <div
      style={{
        padding: 8,
        border: "1px solid var(--border)",
        borderLeft: `3px solid ${runStripe[run.status] || "var(--border)"}`,
        background: "var(--bg-panel)",
        marginBottom: 4,
      }}
    >
      <div className="flex items-center justify-between" style={{ marginBottom: 2 }}>
        <span className="mn hdr" style={{ color: "var(--dim)" }}>{run.status.replace("_", " ")}</span>
        <span className="mn" style={{ fontSize: 9, color: "var(--ghost)" }}>{formatDate(run.started_at)}</span>
      </div>
      {run.summary && <p className="sv" style={{ fontSize: 10, color: "var(--main)" }}>{run.summary}</p>}
      <div className="flex items-center gap-3 mn" style={{ marginTop: 3, fontSize: 9, color: "var(--dim)" }}>
        {run.file_changes.length > 0 && <span>{run.file_changes.length} files</span>}
        {run.outputs.length > 0 && <span>{run.outputs.length} outputs</span>}
      </div>
    </div>
  );
}

const changeIcons: Record<string, { icon: string; color: string }> = {
  created: { icon: "+", color: "var(--accent)" },
  modified: { icon: "~", color: "var(--warn)" },
  deleted: { icon: "-", color: "var(--err)" },
  renamed: { icon: "→", color: "var(--dim)" },
};

function FileChangeRow({ change }: { change: FileChange }) {
  const c = changeIcons[change.change_type] || changeIcons.modified;
  const filename = change.path.split("/").pop() || change.path;
  return (
    <div className="flex items-center gap-2" style={{ paddingBottom: 2 }}>
      <span className="mn" style={{ fontSize: 10, fontWeight: 700, color: c.color }}>{c.icon}</span>
      <span className="mn" style={{ fontSize: 10, color: "var(--main)" }}>{filename}</span>
    </div>
  );
}

function ActionBtn({
  label,
  fill,
  onClick,
  disabled,
}: {
  label: string;
  fill?: boolean;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      className={`btn-cortex ${fill ? "btn-fill" : ""}`}
      style={{ padding: "4px 10px", opacity: disabled ? 0.6 : 1 }}
      onClick={onClick}
      disabled={disabled}
    >
      {label}
    </button>
  );
}
