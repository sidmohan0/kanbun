import type { ConnectorInfo, ConnectorItem } from "@/types";

type ConnectorBusyState = "idle" | "saving" | "syncing" | "deleting";

export interface ConnectorDraft {
  authToken: string;
  vaultPath: string;
}

const statusStyle: Record<string, { color: string; label: string }> = {
  connected: { color: "var(--done)", label: "CONNECTED" },
  disconnected: { color: "var(--dim)", label: "DISCONNECTED" },
  error: { color: "var(--err)", label: "ERROR" },
  needs_auth: { color: "var(--warn)", label: "NEEDS_AUTH" },
};

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ConnectorPanel({
  isTauri,
  connectors,
  selectedConnectorId,
  configuredConnectorIds,
  draft,
  items,
  busyState,
  message,
  error,
  onSelectConnector,
  onDraftChange,
  onSave,
  onSync,
  onRefresh,
  onDelete,
}: {
  isTauri: boolean;
  connectors: ConnectorInfo[];
  selectedConnectorId: string;
  configuredConnectorIds: string[];
  draft: ConnectorDraft;
  items: ConnectorItem[];
  busyState: ConnectorBusyState;
  message: string | null;
  error: string | null;
  onSelectConnector: (connectorId: string) => void;
  onDraftChange: (patch: Partial<ConnectorDraft>) => void;
  onSave: () => void;
  onSync: () => void;
  onRefresh: () => void;
  onDelete: (itemId: string) => void;
}) {
  const selected = connectors.find((connector) => connector.id === selectedConnectorId) ?? connectors[0];
  const selectedId = selected?.id ?? selectedConnectorId;
  const isConfigured = configuredConnectorIds.includes(selectedId);
  const activeStatus = selected ? statusStyle[selected.status] ?? statusStyle.disconnected : statusStyle.disconnected;

  return (
    <section className="flex-1 min-h-0 flex" style={{ position: "relative" }}>
      <aside
        className="shrink-0"
        style={{
          width: 250,
          borderRight: "1px solid var(--border)",
          background: "var(--bg-panel)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          className="flex items-center justify-between"
          style={{ padding: "9px 12px", borderBottom: "1px solid var(--border)" }}
        >
          <span className="hdr" style={{ color: "var(--hi)" }}>
            Connectors
          </span>
          <button className="btn-cortex" style={{ padding: "3px 7px", fontSize: 8 }} onClick={onRefresh}>
            Refresh
          </button>
        </div>
        <div className="overflow-y-auto" style={{ padding: 8 }}>
          {connectors.map((connector) => {
            const status = statusStyle[connector.status] ?? statusStyle.disconnected;
            const configured = configuredConnectorIds.includes(connector.id);
            const active = connector.id === selectedId;
            return (
              <button
                key={connector.id}
                onClick={() => onSelectConnector(connector.id)}
                className="w-full text-left"
                style={{
                  border: active ? "1px solid var(--accent)" : "1px solid var(--border)",
                  background: active ? "var(--accent-soft)" : "var(--bg-card)",
                  padding: "8px 9px",
                  marginBottom: 7,
                }}
              >
                <div className="flex items-center justify-between" style={{ marginBottom: 3 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "var(--hi)" }}>
                    {connector.icon} {connector.name}
                  </span>
                  <span className="mn" style={{ fontSize: 8, color: configured ? "var(--done)" : "var(--ghost)" }}>
                    {configured ? "CFG" : "NEW"}
                  </span>
                </div>
                <div className="mn" style={{ fontSize: 8, color: status.color }}>
                  {status.label}
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      <div className="flex-1 min-h-0 flex flex-col" style={{ background: "var(--bg)" }}>
        {selected ? (
          <>
            <div
              className="flex items-center justify-between"
              style={{
                padding: "10px 14px",
                borderBottom: "1px solid var(--border)",
                background: "var(--bg-panel)",
              }}
            >
              <div>
                <div style={{ fontWeight: 700, color: "var(--hi)", fontSize: 13 }}>
                  {selected.icon} {selected.name}
                </div>
                <div className="mn" style={{ fontSize: 9, color: activeStatus.color }}>
                  {activeStatus.label}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="btn-cortex"
                  style={{ padding: "4px 9px", fontSize: 8 }}
                  onClick={onSave}
                  disabled={!isTauri || busyState !== "idle"}
                >
                  {busyState === "saving" ? "Saving..." : "Save Config"}
                </button>
                <button
                  className="btn-cortex btn-fill"
                  style={{ padding: "4px 9px", fontSize: 8 }}
                  onClick={onSync}
                  disabled={!isTauri || !isConfigured || busyState !== "idle"}
                >
                  {busyState === "syncing" ? "Syncing..." : "Sync Now"}
                </button>
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto" style={{ padding: 14 }}>
              {selected.id === "todoist" && (
                <div style={{ marginBottom: 16 }}>
                  <div className="hdr" style={{ color: "var(--dim)", marginBottom: 6 }}>
                    Todoist Setup
                  </div>
                  <label className="mn" style={{ fontSize: 9, color: "var(--dim)", display: "block", marginBottom: 5 }}>
                    API Token
                  </label>
                  <input
                    type="password"
                    value={draft.authToken}
                    onChange={(e) => onDraftChange({ authToken: e.target.value })}
                    placeholder="Paste your Todoist token"
                    className="mn"
                    style={{
                      width: "100%",
                      border: "1px solid var(--border)",
                      background: "var(--bg-input)",
                      color: "var(--main)",
                      fontSize: 10,
                      padding: "8px 9px",
                    }}
                    disabled={!isTauri || busyState !== "idle"}
                  />
                </div>
              )}

              {selected.id === "obsidian" && (
                <div style={{ marginBottom: 16 }}>
                  <div className="hdr" style={{ color: "var(--dim)", marginBottom: 6 }}>
                    Obsidian Setup
                  </div>
                  <label className="mn" style={{ fontSize: 9, color: "var(--dim)", display: "block", marginBottom: 5 }}>
                    Vault Path
                  </label>
                  <input
                    type="text"
                    value={draft.vaultPath}
                    onChange={(e) => onDraftChange({ vaultPath: e.target.value })}
                    placeholder="~/Documents/ObsidianVault"
                    className="mn"
                    style={{
                      width: "100%",
                      border: "1px solid var(--border)",
                      background: "var(--bg-input)",
                      color: "var(--main)",
                      fontSize: 10,
                      padding: "8px 9px",
                    }}
                    disabled={!isTauri || busyState !== "idle"}
                  />
                </div>
              )}

              {error && (
                <p className="mn" style={{ fontSize: 10, color: "var(--err)", marginBottom: 8 }}>
                  {error}
                </p>
              )}
              {message && (
                <p className="mn" style={{ fontSize: 10, color: "var(--dim)", marginBottom: 8 }}>
                  {message}
                </p>
              )}

              <div className="hdr" style={{ color: "var(--dim)", marginBottom: 6 }}>
                Cached Items ({items.length})
              </div>
              <div style={{ border: "1px solid var(--border)", background: "var(--bg-card)" }}>
                {items.length === 0 ? (
                  <div className="mn" style={{ fontSize: 10, color: "var(--dim)", padding: 10 }}>
                    {isConfigured ? "No cached items yet. Run Sync to fetch data." : "Save connector config to enable sync."}
                  </div>
                ) : (
                  <div style={{ maxHeight: 330, overflowY: "auto" }}>
                    {items.map((item) => (
                      <div
                        key={`${item.source}-${item.id}`}
                        style={{
                          padding: "8px 10px",
                          borderBottom: "1px solid var(--border)",
                          display: "grid",
                          gridTemplateColumns: "1fr auto auto auto",
                          columnGap: 10,
                          alignItems: "center",
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <p style={{ fontSize: 11, color: "var(--hi)", fontWeight: 600, marginBottom: 2 }}>
                            {item.title}
                          </p>
                          <p className="mn" style={{ fontSize: 9, color: "var(--dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {item.tags.join(", ") || item.id}
                          </p>
                        </div>
                        <span className="mn" style={{ fontSize: 8, color: "var(--dim)", textTransform: "uppercase" }}>
                          {item.status}
                        </span>
                        <span className="mn" style={{ fontSize: 8, color: "var(--ghost)" }}>
                          {formatDate(item.updated_at ?? item.created_at)}
                        </span>
                        <button
                          className="btn-cortex"
                          style={{ fontSize: 8, padding: "3px 6px" }}
                          onClick={() => onDelete(item.id)}
                          disabled={!isTauri || busyState !== "idle"}
                        >
                          Delete
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="mn" style={{ padding: 14, color: "var(--dim)" }}>
            No connectors available.
          </div>
        )}
      </div>

      {!isTauri && (
        <div className="empty-obscure-pane" style={{ inset: 14 }}>
          <div className="empty-obscure-card">
            <p className="mn" style={{ fontSize: 10, color: "var(--dim)", marginBottom: 6 }}>
              DESKTOP_RUNTIME_REQUIRED
            </p>
            <p style={{ fontSize: 13, fontWeight: 700, color: "var(--hi)", marginBottom: 6 }}>
              Connector controls are available in the desktop app.
            </p>
            <p className="mn" style={{ fontSize: 10, color: "var(--main)" }}>
              Run `npm run tauri dev` to connect and sync live data.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
