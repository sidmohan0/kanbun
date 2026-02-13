import type { AttentionItem } from "@/types";

type AttentionAction = "retry" | "debug" | "approve" | "deny" | "inspect";

const reasonStyle: Record<string, { stripe: string; badge: string; badgeColor: string; label: string }> = {
  errored: {
    stripe: "var(--err)",
    badge: "var(--err-soft)",
    badgeColor: "var(--err)",
    label: "ERR",
  },
  needs_review: {
    stripe: "var(--accent)",
    badge: "var(--accent-soft)",
    badgeColor: "var(--accent)",
    label: "REVIEW",
  },
  blocked: {
    stripe: "var(--warn)",
    badge: "var(--warn-soft)",
    badgeColor: "var(--warn)",
    label: "BLOCKED",
  },
};

export function AttentionQueue({
  items,
  onItemClick,
  onAction,
}: {
  items: AttentionItem[];
  onItemClick: (agentId: string) => void;
  onAction?: (agentId: string, action: AttentionAction) => void;
}) {
  if (items.length === 0) return null;

  return (
    <section
      className="shrink-0 flex flex-col"
      style={{
        height: 155,
        borderBottom: "1px solid var(--border)",
        background: "var(--bg-panel)",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between"
        style={{
          height: 26,
          borderBottom: "1px solid var(--border)",
          padding: "0 16px",
        }}
      >
        <span className="hdr" style={{ color: "var(--accent)", display: "flex", alignItems: "center", gap: 5 }}>
          <span className="pulse-soft">●</span> Attention Queue [{items.length}]
        </span>
        <span className="mn" style={{ fontSize: 9, color: "var(--dim)" }}>
          REQUIRES_INTERVENTION
        </span>
      </div>

      {/* Cards */}
      <div className="flex-1 flex gap-2.5 overflow-x-auto items-stretch" style={{ padding: "8px 16px" }}>
        {items.map((item) => {
          const rs = reasonStyle[item.reason] || reasonStyle.errored;
          return (
            <button
              key={`${item.agent_id}-${item.reason}`}
              onClick={() => onItemClick(item.agent_id)}
              className="attn-card text-left"
            >
              {/* Left stripe */}
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: 3,
                  height: "100%",
                  background: rs.stripe,
                }}
              />

              {/* Card header */}
              <div
                className="flex items-center justify-between"
                style={{
                  padding: "7px 10px",
                  borderBottom: "1px solid var(--border)",
                  background: "var(--bg-panel)",
                }}
              >
                <span style={{ fontWeight: 700, color: "var(--hi)", fontSize: 11 }}>
                  {item.agent_name.toUpperCase().replace(/\s+/g, "_")}
                </span>
                <span
                  className="mn"
                  style={{
                    fontSize: 8,
                    border: `1px solid ${rs.badgeColor}`,
                    color: rs.badgeColor,
                    padding: "1px 4px",
                    background: rs.badge,
                  }}
                >
                  {rs.label}
                </span>
              </div>

              {/* Card body */}
              <div
                style={{
                  padding: "7px 10px",
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                }}
              >
                <div>
                  <div className="mn" style={{ fontSize: 9, color: "var(--dim)", marginBottom: 2 }}>
                    {item.project_name}
                  </div>
                  <div className="sv" style={{ fontSize: 11, color: "var(--main)" }}>
                    &ldquo;{item.reason === "errored"
                      ? "Error encountered. Needs debug."
                      : item.reason === "blocked"
                      ? "Waiting for approval..."
                      : "Changes ready for review."}&rdquo;
                  </div>
                </div>
                <div className="flex gap-1 mt-1.5">
                  {item.reason === "errored" && (
                    <>
                      <button
                        className="btn-cortex flex-1 text-center"
                        style={{ padding: "4px 0" }}
                        onClick={(event) => {
                          event.stopPropagation();
                          onAction?.(item.agent_id, "retry");
                        }}
                      >
                        Retry
                      </button>
                      <button
                        className="btn-cortex flex-1 text-center"
                        style={{ padding: "4px 0" }}
                        onClick={(event) => {
                          event.stopPropagation();
                          onAction?.(item.agent_id, "debug");
                        }}
                      >
                        Debug
                      </button>
                    </>
                  )}
                  {item.reason === "blocked" && (
                    <>
                      <button
                        className="btn-cortex btn-fill flex-1 text-center"
                        style={{ padding: "4px 0" }}
                        onClick={(event) => {
                          event.stopPropagation();
                          onAction?.(item.agent_id, "approve");
                        }}
                      >
                        Approve
                      </button>
                      <button
                        className="btn-cortex flex-1 text-center"
                        style={{ padding: "4px 0" }}
                        onClick={(event) => {
                          event.stopPropagation();
                          onAction?.(item.agent_id, "deny");
                        }}
                      >
                        Deny
                      </button>
                    </>
                  )}
                  {item.reason === "needs_review" && (
                    <button
                      className="btn-cortex flex-1 text-center"
                      style={{ padding: "4px 0" }}
                      onClick={(event) => {
                        event.stopPropagation();
                        onAction?.(item.agent_id, "inspect");
                      }}
                    >
                      Inspect Changes
                    </button>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
