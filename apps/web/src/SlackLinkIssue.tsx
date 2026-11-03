import { useMemo, useState } from "react";
import type { Row } from "@kanbun/model";
import { canonicalSlackMessageUrl } from "@kanbun/mutators";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { workspace, type WorkspaceSnapshot } from "./workspace";

export function SlackLinkIssue({
  url,
  snapshot,
  onLinked,
}: {
  url: string;
  snapshot: WorkspaceSnapshot;
  onLinked(issueId: string): void;
}) {
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  let safeUrl: string | null = null;
  try {
    safeUrl = canonicalSlackMessageUrl(url);
  } catch {
    /* The mutation repeats validation at the server boundary. */
  }
  const candidates = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return snapshot.issues
      .filter((issue) => !issue.archivedAt && !issue.trashed)
      .filter((issue) => {
        if (!term) return true;
        const team = snapshot.teams.find((candidate) => candidate.id === issue.teamId);
        return `${team?.key ?? ""}-${issue.number} ${issue.title}`.toLocaleLowerCase().includes(term);
      })
      .slice(0, 50);
  }, [query, snapshot.issues, snapshot.teams]);
  function identifier(issue: Row<"issue">) {
    const team = snapshot.teams.find((candidate) => candidate.id === issue.teamId);
    return issue.number > 0 ? `${team?.key ?? "ISSUE"}-${issue.number}` : "Pending issue";
  }
  function attach(issue: Row<"issue">) {
    try {
      workspace.attachSlackMessage(issue, safeUrl!, "Slack message");
      setError(null);
      onLinked(issue.id);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The Slack link could not be saved.");
    }
  }
  return (
    <section className="empty-state" aria-label="Link Slack message to issue">
      <h2>Link Slack message to an issue</h2>
      <p>
        This saves a link only. Kanbun won’t copy the message or synchronize its thread. Your active Kanbun account must
        have access to the selected issue.
      </p>
      {safeUrl ? (
        <>
          <label>
            Search issues by identifier or title
            <Input
              autoFocus
              aria-label="Search issues by identifier or title"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="ENG-123 or issue title"
            />
          </label>
          <ul>
            {candidates.map((issue) => (
              <li key={issue.id}>
                <span>
                  <strong>{identifier(issue)}</strong> · {issue.title}
                </span>{" "}
                <Button variant="outline" size="sm" onClick={() => attach(issue)}>
                  Link to {identifier(issue)}
                </Button>
              </li>
            ))}
          </ul>
          {!candidates.length && <p>No matching active issues are available to your account.</p>}
        </>
      ) : (
        <p role="alert">This Slack message URL is not supported. Open Slack and run the message action again.</p>
      )}
      {error && <p role="alert">{error}</p>}
      <a className="back-to-issues" href="#issues">
        Cancel and return to issues
      </a>
    </section>
  );
}
