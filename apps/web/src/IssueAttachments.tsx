import { useEffect, useState, type FormEvent } from "react";
import type { Row } from "@kanbun/model";
import { canonicalSlackMessageUrl } from "@kanbun/mutators";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { workspace, type WorkspaceSnapshot } from "./workspace";

export function IssueAttachments({ issue, snapshot }: { issue: Row<"issue">; snapshot: WorkspaceSnapshot }) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (snapshot.phase !== "ready") return;
    let active = true;
    void workspace
      .loadAttachments(issue.id)
      .then(() => {
        if (active) {
          setLoaded(true);
          setLoadError(null);
        }
      })
      .catch(() => {
        if (active) setLoadError("Slack message links could not be loaded. Reconnect or reload to retry.");
      });
    return () => {
      active = false;
    };
  }, [issue.id, snapshot.phase, snapshot.status]);
  const links = snapshot.attachments.filter((row) => row.issueId === issue.id && row.sourceType === "slack");
  const unavailable = !loaded || !!issue.trashed || !!issue.archivedAt;
  function change(action: () => void) {
    try {
      action();
      setError(null);
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "This link could not be saved.");
      return false;
    }
  }
  function add(event: FormEvent) {
    event.preventDefault();
    if (change(() => workspace.attachSlackMessage(issue, url.trim(), title.trim() || "Slack message"))) {
      setUrl("");
      setTitle("");
    }
  }
  return (
    <section aria-label="Slack message links">
      <h3>Slack message links</h3>
      <p>
        Paste a message link from Slack. Links do not sync comments or send updates to Slack. Opening a link requires
        access to its Slack channel.
      </p>
      <ul>
        {links.map((row) => {
          let safe = false;
          try {
            safe = canonicalSlackMessageUrl(row.url) === row.url;
          } catch {
            /* Unsupported historical links stay inert. */
          }
          return (
            <li key={row.id}>
              {safe ? (
                <a href={row.url} target="_blank" rel="noopener noreferrer">
                  {row.title}
                </a>
              ) : (
                <span>{row.title}</span>
              )}
              <Button
                variant="ghost"
                size="sm"
                disabled={unavailable}
                aria-label={`Remove ${row.title}`}
                onClick={() => change(() => workspace.detachSlackMessage(issue, row.id))}
              >
                Remove
              </Button>
            </li>
          );
        })}
      </ul>
      <form onSubmit={add}>
        <label>
          Slack message URL
          <Input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            required
            maxLength={2048}
            disabled={unavailable}
            placeholder="https://workspace.slack.com/archives/…"
          />
        </label>
        <label>
          Link title
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={500}
            disabled={unavailable}
            placeholder="Slack message"
          />
        </label>
        <Button type="submit" variant="outline" disabled={unavailable}>
          Add Slack link
        </Button>
      </form>
      {(error || loadError) && (
        <p role="alert" className="notice">
          {error || loadError}
        </p>
      )}
    </section>
  );
}
