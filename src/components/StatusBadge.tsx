import type { AgentStatus } from "@/types";

const dotClass: Record<AgentStatus, string> = {
  running: "dot-running blink",
  idle: "dot-idle",
  completed: "dot-completed",
  errored: "dot-errored",
  blocked: "dot-blocked",
};

const labelStyle: Record<AgentStatus, { color: string; label: string }> = {
  running: { color: "var(--accent)", label: "ACTIVE" },
  idle: { color: "var(--dim)", label: "IDLE" },
  completed: { color: "var(--done)", label: "DONE" },
  errored: { color: "var(--err)", label: "ERR" },
  blocked: { color: "var(--warn)", label: "BLOCKED" },
};

export function StatusBadge({ status }: { status: AgentStatus }) {
  const ls = labelStyle[status];
  return (
    <span
      className="mn"
      style={{
        fontSize: 8,
        border: `1px solid ${ls.color}`,
        color: ls.color,
        padding: "1px 5px",
        letterSpacing: "0.06em",
      }}
    >
      {ls.label}
    </span>
  );
}

export function StatusDot({ status }: { status: AgentStatus }) {
  return <span className={`dot ${dotClass[status]}`} title={labelStyle[status].label} />;
}
