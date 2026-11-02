import { useEffect, useState } from "react";
import { Button } from "./components/ui/button";
import { membershipRequest } from "./membership";
import type { WorkspaceSnapshot } from "./workspace";
import { DesktopIntegrationSettings, isDesktopApplication } from "./DesktopIntegrationSettings";

type Connection = {
  configured: boolean;
  connection: {
    teamId: string;
    teamName: string;
    unfurlsEnabled: boolean;
    reauthorizationRequired: boolean;
    issueRepliesEnabled: boolean;
    issueRepliesReauthorizationRequired: boolean;
  } | null;
};
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
  async function unfurls(enabled: boolean) {
    const previous = value;
    if (value?.connection) setValue({ ...value, connection: { ...value.connection, unfurlsEnabled: enabled } });
    setBusy(true);
    setError(null);
    try {
      setValue((await membershipRequest("/api/integrations/slack/unfurls", { enabled })) as Connection);
    } catch (failure) {
      setValue(previous);
      setError(failure instanceof Error ? failure.message : "Slack previews could not be changed.");
    } finally {
      setBusy(false);
    }
  }
  async function replies(enabled: boolean) {
    const previous = value;
    if (value?.connection) setValue({ ...value, connection: { ...value.connection, issueRepliesEnabled: enabled } });
    setBusy(true);
    setError(null);
    try {
      setValue((await membershipRequest("/api/integrations/slack/issue-replies", { enabled })) as Connection);
    } catch (failure) {
      setValue(previous);
      setError(failure instanceof Error ? failure.message : "Slack replies could not be changed.");
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
      {value?.connection && (
        <>
          <label>
            <input
              type="checkbox"
              checked={value.connection.unfurlsEnabled}
              disabled={busy}
              onChange={(event) => void unfurls(event.target.checked)}
            />{" "}
            Preview public issue links in Slack
          </label>
          <p>Only issues in public teams are shared. Existing previews remain in Slack after disabling.</p>
          {value.connection.reauthorizationRequired && <p>Update Slack authorization to enable link previews.</p>}
          <label>
            <input
              type="checkbox"
              checked={value.connection.issueRepliesEnabled}
              disabled={busy}
              onChange={(event) => void replies(event.target.checked)}
            />{" "}
            Reply to issue IDs in public Slack channels
          </label>
          <p>
            Off by default. Anyone in the channel can see the public-team issue identifier and link. Requires reading
            messages in public channels where the app participates; message text is not stored. Repeated mentions of the
            same issue in a thread are suppressed for 60 minutes.
          </p>
          {value.connection.issueRepliesReauthorizationRequired && (
            <p>Update Slack authorization to allow public-channel message events for issue replies.</p>
          )}
        </>
      )}
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
      {value?.configured && (
        <p>This connection authorizes Kanbun to post messages and preview public issue links in Slack.</p>
      )}
    </section>
  );
}
export function SlackSettings({ snapshot }: { snapshot: WorkspaceSnapshot }) {
  if (snapshot.context?.mode !== "hosted" || snapshot.context.role !== "owner") return null;
  return isDesktopApplication() ? <DesktopIntegrationSettings name="Slack" /> : <OwnerSlackSettings />;
}
