import { useEffect, useState } from "preact/hooks";

interface EmailAccount {
  id: number;
  provider: "gmail" | "outlook";
  email_address: string;
  display_name: string;
}

interface SystemInfo {
  version: string | null;
  port: number;
  db_path: string | null;
  oauth: {
    gmail: { configured: boolean; missing: string[] };
    outlook: { configured: boolean; missing: string[] };
  };
}

interface Props {
  onBackToPeople: () => void;
  onShowProjects: () => void;
  onShowDrafts: () => void;
  onShowGroups: () => void;
}

export function SettingsPage({ onBackToPeople, onShowProjects, onShowDrafts, onShowGroups }: Props) {
  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadAccounts();
    loadSystem();
  }, []);

  async function loadAccounts() {
    try {
      const res = await fetch("/api/accounts");
      if (!res.ok) return;
      const data = await res.json();
      setAccounts(data);
    } catch {
      // ignore
    }
  }

  async function loadSystem() {
    try {
      const res = await fetch("/api/system");
      if (!res.ok) {
        setError("System info unavailable");
        return;
      }
      const data = (await res.json()) as SystemInfo;
      setSystem(data);
    } catch {
      setError("System info unavailable");
    }
  }

  function openOAuth(provider: "gmail" | "outlook") {
    window.open(`/api/accounts/oauth/${provider}/start`, "_blank");
  }

  return (
    <>
      <div class="people-header">
        <div>
          <h1 class="people-title">Settings</h1>
          <p class="people-subtitle">Manage email connections and see system configuration.</p>
        </div>
      </div>

      {error && (
        <p style="font-size:12px;color:#c62828;margin-bottom:8px;">{error}</p>
      )}

      <div class="info-cards" style="flex-direction:column;gap:16px;max-width:800px;">
        <div class="people-header">
          <div>
            <h1 class="people-title">Settings</h1>
            <p class="people-subtitle">Manage email connections and see system configuration.</p>
          </div>
        </div>

        {error && (
          <p style="font-size:12px;color:#c62828;margin-bottom:8px;">{error}</p>
        )}

        <div class="info-cards" style="flex-direction:column;gap:16px;max-width:800px;">
          <div class="info-card">
            <h3>Email & Integrations</h3>
            <p style="font-size:12px;color:#666;margin-bottom:8px;">Connected email accounts are used for sending drafts and syncing replies.</p>

            {accounts.length === 0 && (
              <p style="font-size:12px;color:#999;margin-bottom:8px;">No email accounts connected yet.</p>
            )}

            {accounts.length > 0 && (
              <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:8px;">
                <thead>
                  <tr>
                    <th style="text-align:left;border-bottom:1px solid #e0e0e0;padding:4px 6px;">Provider</th>
                    <th style="text-align:left;border-bottom:1px solid #e0e0e0;padding:4px 6px;">Email</th>
                    <th style="text-align:left;border-bottom:1px solid #e0e0e0;padding:4px 6px;">Name</th>
                    <th style="text-align:left;border-bottom:1px solid #e0e0e0;padding:4px 6px;">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((a) => (
                    <tr key={a.id}>
                      <td style="border-bottom:1px solid #f5f5f5;padding:4px 6px;text-transform:capitalize;">{a.provider}</td>
                      <td style="border-bottom:1px solid #f5f5f5;padding:4px 6px;">{a.email_address}</td>
                      <td style="border-bottom:1px solid #f5f5f5;padding:4px 6px;">{a.display_name}</td>
                      <td style="border-bottom:1px solid #f5f5f5;padding:4px 6px;">
                        <button
                          class="btn"
                          style="font-size:11px;padding:2px 6px;"
                          onClick={async () => {
                            if (!confirm("Disconnect this account?")) return;
                            await fetch(`/api/accounts/${a.id}`, { method: "DELETE" });
                            await loadAccounts();
                          }}
                        >
                          Disconnect
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
              <button class="btn" onClick={() => openOAuth("gmail")}>
                Connect Gmail
              </button>
              <button class="btn" onClick={() => openOAuth("outlook")}>
                Connect Outlook
              </button>
            </div>

            {system && (
              <div style="margin-top:8px;font-size:12px;color:#666;">
                {!system.oauth.gmail.configured && (
                  <p style="margin-top:4px;color:#c62828;">
                    Google OAuth env vars not configured. Missing: {system.oauth.gmail.missing.join(", ") || "(none)"}.
                  </p>
                )}
                {!system.oauth.outlook.configured && (
                  <p style="margin-top:4px;color:#c62828;">
                    Outlook OAuth env vars not configured. Missing: {system.oauth.outlook.missing.join(", ") || "(none)"}.
                  </p>
                )}
              </div>
            )}
          </div>

          <div class="info-card">
            <h3>System</h3>
            {system ? (
              <div style="font-size:13px;">
                <div style="margin-bottom:4px;">
                  <span class="field-label">Version</span>
                  <span>{system.version ?? "Unknown"}</span>
                </div>
                <div style="margin-bottom:4px;">
                  <span class="field-label">Server Port</span>
                  <span>{system.port}</span>
                </div>
                <div style="margin-bottom:4px;">
                  <span class="field-label">Database Path</span>
                  <span>{system.db_path ?? "Unknown"}</span>
                </div>
                <div style="margin-top:8px;">
                  <span class="field-label">OAuth Configuration</span>
                  <div style="display:flex;gap:12px;font-size:12px;margin-top:4px;">
                    <span>
                      Gmail: {system.oauth.gmail.configured ? "Configured" : "Missing"}
                    </span>
                    <span>
                      Outlook: {system.oauth.outlook.configured ? "Configured" : "Missing"}
                    </span>
                  </div>
                </div>
                <p style="font-size:11px;color:#777;margin-top:8px;">
                  To change these values, edit your <code>.env</code> file and restart Kanbun.
                </p>
              </div>
            ) : (
              <p style="font-size:12px;color:#999;">Loading system info…</p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
