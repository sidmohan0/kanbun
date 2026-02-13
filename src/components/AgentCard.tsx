import type { AgentSummary } from "@/types";
import { StatusDot } from "./StatusBadge";

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "never";
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function AgentCard({
  summary,
  selected,
  onClick,
}: {
  summary: AgentSummary;
  selected?: boolean;
  onClick: () => void;
}) {
  const { agent, recent_run } = summary;
  const isActive = agent.status === "running";
  const isErr = agent.status === "errored";
  const isBlk = agent.status === "blocked";

  const statusColor = isErr
    ? "var(--err)"
    : isBlk
    ? "var(--warn)"
    : isActive
    ? "var(--main)"
    : "var(--dim)";

  return (
    <button
      onClick={onClick}
      className={`agent-card w-full text-left ${selected ? "selected" : ""}`}
      style={
        {
          padding: 10,
          height: 105,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
        }
      }
    >
      <div className="flex justify-between items-start">
        <div>
          <div style={{ fontWeight: 700, color: "var(--hi)", fontSize: 11 }}>
            {agent.name.toUpperCase().replace(/\s+/g, "_")}
          </div>
          <span className="fn-tag">{agent.function_tag}</span>
        </div>
        <StatusDot status={agent.status} />
      </div>

      <div>
        <div className="mn" style={{ fontSize: 9, color: "var(--dim)", marginBottom: 1 }}>
          {isActive ? "CURRENT_OP" : "STATUS"}
        </div>
        {isActive && recent_run?.summary ? (
          <div style={{ fontSize: 10, color: "var(--main)", lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {recent_run.summary}
          </div>
        ) : (
          <div className="sv" style={{ fontSize: 10, color: statusColor }}>
            {isErr
              ? recent_run?.summary || "Error encountered"
              : isBlk
              ? recent_run?.summary || "Blocked"
              : agent.status === "completed"
              ? `Completed. ${timeAgo(agent.last_active_at)}.`
              : `Idle. ${agent.last_active_at ? timeAgo(agent.last_active_at) + "." : "Ready."}`}
          </div>
        )}
      </div>
    </button>
  );
}
