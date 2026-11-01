import { useEffect, useState } from "react";
import { Button } from "./components/ui/button";
import { membershipRequest } from "./membership";
import type { WorkspaceSnapshot } from "./workspace";

type Connection = { configured: boolean; connection: { teamId: string; teamName: string } | null };
function OwnerSlackSettings() {
  const [value, setValue] = useState<Connection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    void membershipRequest("/api/integrations/slack")
      .then((result) => {
        if (active) setValue(result as Connection);
      })
      .catch((failure: unknown) => {
        if (active) setError(failure instanceof Error ? failure.message : "Slack could not be loaded.");
      });
    return () => {
      active = false;
    };
  }, [revision]);
  async function action(disconnect: boolean) {
    setBusy(true);
    setError(null);
    try {
      const result = await membershipRequest(`/api/integrations/slack/${disconnect ? "disconnect" : "connect"}`, {});
      if (disconnect) setRevision((v) => v + 1);
      else {
        const destination = result as { url?: unknown };
        const url = typeof destination.url === "string" ? new URL(destination.url) : null;
        if (!url || url.origin !== "https://slack.com" || url.pathname !== "/oauth/v2/authorize")
          throw new Error("Invalid Slack authorization destination.");
        location.assign(url.href);
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Slack connection could not be changed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="github-settings" aria-label="Slack connection">
      <h2>Slack</h2>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {!value && !error && <p role="status">Loading Slack connection…</p>}
      {value && !value.configured && <p>Slack is not configured.</p>}
      {value?.connection && <p>Connected to {value.connection.teamName}.</p>}
      {value?.configured && (
        <Button variant="outline" disabled={busy} onClick={() => void action(false)}>
          {busy ? "Please wait…" : value.connection ? "Update Slack authorization" : "Connect Slack"}
        </Button>
      )}
      {value?.connection && (
        <Button variant="ghost" disabled={busy} onClick={() => void action(true)}>
          Disconnect Slack
        </Button>
      )}
      {value?.configured && <p>This connection authorizes Kanbun to post messages in Slack.</p>}
    </section>
  );
}
export function SlackSettings({ snapshot }: { snapshot: WorkspaceSnapshot }) {
  return snapshot.context?.mode === "hosted" && snapshot.context.role === "owner" ? <OwnerSlackSettings /> : null;
}
