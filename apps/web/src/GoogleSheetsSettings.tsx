import { useEffect, useState } from "react";
import type { WorkspaceSnapshot } from "./workspace";
import { membershipRequest } from "./membership";
import { Button } from "./components/ui/button";
import { DesktopIntegrationSettings, isDesktopApplication } from "./DesktopIntegrationSettings";

type Connection = {
  configured: boolean;
  connected: boolean;
  spreadsheetUrl: string | null;
  projectsEnabled: boolean;
  lastSyncedAt: string | null;
  error: string | null;
};
function connection(value: unknown): Connection {
  if (!value || typeof value !== "object") throw new Error("Google Sheets connection could not be read.");
  const v = value as Connection;
  if (
    typeof v.configured !== "boolean" ||
    typeof v.connected !== "boolean" ||
    typeof v.projectsEnabled !== "boolean" ||
    (v.spreadsheetUrl !== null &&
      (typeof v.spreadsheetUrl !== "string" ||
        !/^https:\/\/docs\.google\.com\/spreadsheets\/d\/[A-Za-z0-9_-]+\/edit$/.test(v.spreadsheetUrl)))
  )
    throw new Error("Google Sheets connection could not be read.");
  return v;
}
function OwnerGoogleSheetsSettings() {
  const [state, setState] = useState<Connection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void membershipRequest("/api/integrations/google-sheets")
      .then(connection)
      .then((value) => {
        if (active) setState(value);
      })
      .catch(() => {
        if (active) setError("Google Sheets connection could not be loaded.");
      });
    return () => {
      active = false;
    };
  }, []);
  async function action(name: "connect" | "sync" | "configure" | "disconnect", input: object = {}) {
    const previous = state;
    if (name === "configure" && state && "projectsEnabled" in input && typeof input.projectsEnabled === "boolean")
      setState({ ...state, projectsEnabled: input.projectsEnabled });
    setBusy(true);
    setError(null);
    try {
      const result = await membershipRequest(`/api/integrations/google-sheets/${name}`, input);
      if (name === "connect") {
        if (!result || typeof result !== "object" || !("url" in result) || typeof result.url !== "string")
          throw new Error("Google authorization could not start.");
        const url = new URL(result.url);
        if (
          url.origin !== "https://accounts.google.com" ||
          url.pathname !== "/o/oauth2/v2/auth" ||
          url.username ||
          url.password
        )
          throw new Error("Google returned an invalid authorization destination.");
        window.location.assign(url.href);
      } else setState(connection(result));
    } catch (failure) {
      if (name === "configure") setState(previous);
      setError(failure instanceof Error ? failure.message : "Google Sheets could not be changed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="github-settings" aria-label="Google Sheets connection">
      <h2>Google Sheets</h2>
      <p>
        Export public-team issues and optional projects to a Google spreadsheet. Changed data refreshes hourly.
        Private-team issues and private-only projects are excluded.
      </p>
      <p>
        Kanbun overwrites its Issues and Projects tabs when refreshing. Keep formulas and analytics in a separate tab or
        spreadsheet, and manage sharing in Google.
      </p>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {state?.error && (
        <p className="notice" role="alert">
          {state.error}
        </p>
      )}
      {!state && !error && <p role="status">Loading Google Sheets connection…</p>}
      {state && !state.configured && <p>Google Sheets is not configured for this installation.</p>}
      {state?.configured && (
        <>
          <Button disabled={busy} onClick={() => void action("connect")}>
            {state.connected ? "Reconnect Google" : "Connect Google Sheets"}
          </Button>
          {state.connected && (
            <>
              {state.spreadsheetUrl && (
                <p>
                  <a href={state.spreadsheetUrl} target="_blank" rel="noreferrer">
                    Open synced spreadsheet
                  </a>
                </p>
              )}
              <label>
                <input
                  type="checkbox"
                  checked={state.projectsEnabled}
                  disabled={busy}
                  onChange={(event) => void action("configure", { projectsEnabled: event.target.checked })}
                />{" "}
                Include projects
              </label>
              <p>
                {state.lastSyncedAt
                  ? `Last updated ${new Date(state.lastSyncedAt).toLocaleString()}`
                  : "No successful refresh yet."}
              </p>
              <div className="github-connection-actions">
                <Button disabled={busy} onClick={() => void action("sync")}>
                  Update now
                </Button>
                <Button variant="outline" disabled={busy} onClick={() => void action("disconnect")}>
                  Disconnect Google Sheets
                </Button>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}

export function GoogleSheetsSettings({ snapshot }: { snapshot: WorkspaceSnapshot }) {
  if (snapshot.context?.mode !== "hosted" || snapshot.context.role !== "owner") return null;
  return isDesktopApplication() ? <DesktopIntegrationSettings name="Google Sheets" /> : <OwnerGoogleSheetsSettings />;
}
