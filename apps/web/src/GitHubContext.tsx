import { Input } from "./components/ui/input";
import { Button } from "./components/ui/button";
import { Cloud, ExternalLink, Network, Server, Triangle } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { GITHUB_PREVIEW_MAX_AGE_MS } from "@kanbun/events";
import type { Row } from "@kanbun/model";
import { branchName, DEFAULT_GIT_BRANCH_FORMAT, issueIdentifier } from "@kanbun/mutators";
import { issueIncarnation } from "@kanbun/sync";
import { membershipRequest } from "./membership";
import { workspace, type WorkspaceSnapshot } from "./workspace";
import {
  activePreviewLinks,
  checksLabel,
  checksStatus,
  githubUrl,
  pullRequestLocation,
  reviewLabel,
  reviewStatus,
} from "./github";
import "./styles/github.css";

export function issuePullRequests(
  issue: Row<"issue">,
  repositories: readonly Row<"githubRepository">[],
  links: readonly Row<"issuePullRequest">[],
) {
  if (issue.archivedAt || issue.trashed) return [];
  const bindings = new Set(
    repositories.filter((repo) => !repo.archivedAt && repo.teamId === issue.teamId).map((repo) => repo.id),
  );
  return links
    .filter(
      (link) =>
        !link.archivedAt &&
        link.issueId === issue.id &&
        link.issueIncarnation === issueIncarnation(issue) &&
        link.teamId === issue.teamId &&
        bindings.has(link.repositoryBindingId),
    )
    .sort((left, right) => right.observedAt.localeCompare(left.observedAt) || left.id.localeCompare(right.id));
}

function PullRequestSignals({ pr }: { pr: Row<"issuePullRequest"> }) {
  const checks = checksStatus(pr),
    review = reviewStatus(pr);
  return (
    <span className="github-signals">
      <span className="github-state" data-state={pr.state}>
        {pr.state[0]!.toUpperCase() + pr.state.slice(1)}
      </span>
      <span data-checks={checks}>{checksLabel[checks]}</span>
      <span data-review={review}>{reviewLabel[review]}</span>
    </span>
  );
}

function PullRequestReviewers({ pr, label }: { pr: Row<"issuePullRequest">; label: string }) {
  if (pr.reviewHeadSha !== pr.headSha || pr.reviewers.length === 0) return null;
  return (
    <ul className="github-reviewers" aria-label={label}>
      {pr.reviewers.map((reviewer) => (
        <li key={`${reviewer.login}:${reviewer.state}`}>
          <span>{reviewer.login}</span>
          <span>{reviewer.state === "approved" ? "Approved" : "Changes requested"}</span>
        </li>
      ))}
    </ul>
  );
}

function PullRequestPreviews({ pr, label }: { pr: Row<"issuePullRequest">; label: string }) {
  const [now, setNow] = useState(Date.now);
  const expiryAt = Math.min(
    ...pr.previewLinks
      .map((preview) => Date.parse(preview.updatedAt) + GITHUB_PREVIEW_MAX_AGE_MS)
      .filter(Number.isFinite),
    Number.POSITIVE_INFINITY,
  );
  useEffect(() => {
    if (!Number.isFinite(expiryAt) || expiryAt <= now) return;
    const delay = Math.max(0, Math.min(expiryAt - now + 1, 2_147_483_647));
    const timer = window.setTimeout(() => setNow(Date.now()), delay);
    return () => window.clearTimeout(timer);
  }, [expiryAt, now]);
  const links = activePreviewLinks(pr.previewLinks, now);
  if (!links.length) return null;
  const icons = { cloud: Cloud, network: Network, server: Server, triangle: Triangle, external: ExternalLink };
  return (
    <details className="github-previews">
      <summary aria-label={label}>Preview links ({links.length})</summary>
      <ul>
        {links.map((preview) => {
          const Icon = icons[preview.icon];
          return (
            <li key={preview.url}>
              <a href={preview.url} target="_blank" rel="noreferrer">
                <Icon aria-hidden="true" size={14} />
                <span>{preview.label}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

/** Compact contextual links are siblings of existing title controls, never nested interactive elements. */
export function GitHubPullRequestChips({
  pullRequests,
  repositories,
}: {
  pullRequests: readonly Row<"issuePullRequest">[];
  repositories: readonly Row<"githubRepository">[];
}) {
  if (!pullRequests.length) return null;
  return (
    <ul className="github-pr-chips" aria-label="Linked GitHub pull requests">
      {pullRequests.map((pr) => {
        const repository = repositories.find((binding) => binding.id === pr.repositoryBindingId);
        const url = githubUrl(pr.url);
        if (!repository || !url) return null;
        return (
          <li key={pr.id}>
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              aria-label={`${repository.owner}/${repository.name} pull request #${pr.number}: ${pr.title}`}
            >
              <span>
                {repository.owner}/{repository.name} #{pr.number}
              </span>
              <span className="github-chip-branch">{pr.headRef}</span>
              <span>{checksLabel[checksStatus(pr)]}</span>
              <span>{reviewLabel[reviewStatus(pr)]}</span>
              <span className="github-state" data-state={pr.state}>
                {pr.state}
              </span>
            </a>
            <PullRequestReviewers
              pr={pr}
              label={`Current-head reviewers for ${repository.owner}/${repository.name} #${pr.number}`}
            />
          </li>
        );
      })}
    </ul>
  );
}

export function IssueDevelopment({ issue, snapshot }: { issue: Row<"issue">; snapshot: WorkspaceSnapshot }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [linkbackStatus, setLinkbackStatus] = useState<string | null>(null);
  const team = snapshot.teams.find((candidate) => candidate.id === issue.teamId);
  const member = snapshot.members.find((candidate) => candidate.id === snapshot.context?.actor.id);
  const gitBranch = team
    ? branchName(
        snapshot.organization?.gitBranchFormat ?? DEFAULT_GIT_BRANCH_FORMAT,
        member?.displayName ?? "member",
        issueIdentifier(team, issue),
        issue.title,
      )
    : "";
  const copyBranch = useCallback(async () => {
    if (!gitBranch || issue.archivedAt || issue.trashed) return;
    setError(null);
    setCopied(null);
    try {
      if (!navigator.clipboard?.writeText)
        throw new Error("Clipboard access is unavailable. Select and copy the branch name below.");
      await navigator.clipboard.writeText(gitBranch);
      setCopied(gitBranch);
    } catch {
      setError("The branch name could not be copied. Select and copy it below, or allow clipboard access.");
      return;
    }
    try {
      if (snapshot.userSettings?.moveIssueToStartOnBranchCopy)
        workspace.branchNameCopied(issue.id, issue.teamId, issueIncarnation(issue));
    } catch (failure) {
      setError(`Branch name copied. ${failure instanceof Error ? failure.message : "The issue could not be started."}`);
    }
  }, [gitBranch, issue, snapshot.userSettings]);
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        event.altKey ||
        !(event.metaKey || event.ctrlKey) ||
        !event.shiftKey ||
        event.code !== "Period" ||
        (event.target instanceof Element &&
          event.target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])")) ||
        !gitBranch
      )
        return;
      event.preventDefault();
      void copyBranch();
    }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [copyBranch, gitBranch]);
  const repositories = snapshot.githubRepositories.filter(
    (repository) => repository.teamId === issue.teamId && !repository.archivedAt,
  );
  const links = issuePullRequests(issue, repositories, snapshot.issuePullRequests);
  async function perform(key: string, action: () => Promise<void>) {
    if (busy) return;
    setBusy(key);
    setError(null);
    try {
      await action();
      await workspace.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "GitHub context could not be updated.");
    } finally {
      setBusy(null);
    }
  }
  function link(event: FormEvent) {
    event.preventDefault();
    const location = pullRequestLocation(url);
    const repository =
      location &&
      repositories.find(
        (candidate) =>
          candidate.owner.toLowerCase() === location.owner.toLowerCase() &&
          candidate.name.toLowerCase() === location.name.toLowerCase(),
      );
    if (!location) {
      setError("Enter a GitHub pull request URL, such as https://github.com/owner/repository/pull/123.");
      return;
    }
    if (!repository) {
      setError(
        "That repository is not connected to this issue’s team. Ask the workspace owner to connect it in Settings.",
      );
      return;
    }
    void perform("link", async () => {
      await membershipRequest("/api/integrations/github/pull-requests/link", {
        issueId: issue.id,
        issueIncarnation: issueIncarnation(issue),
        repositoryBindingId: repository.id,
        url: location.url,
      });
      setUrl("");
    });
  }
  return (
    <section className="issue-development" aria-label="Development">
      <header className="github-section-heading">
        <h3>Development</h3>
      </header>
      <div className="github-branch-copy">
        {gitBranch ? (
          <code>{gitBranch}</code>
        ) : (
          <span>
            {issue.number > 0
              ? "Branch name unavailable. Check the format in Settings."
              : "Waiting for the issue number…"}
          </span>
        )}
        <Button
          variant="outline"
          size="sm"
          disabled={!gitBranch || Boolean(issue.archivedAt) || issue.trashed}
          onClick={() => void copyBranch()}
          aria-keyshortcuts="Control+Shift+. Meta+Shift+."
        >
          Copy git branch name
        </Button>
        {copied === gitBranch && <span role="status">Branch name copied</span>}
      </div>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {linkbackStatus && <p role="status">{linkbackStatus}</p>}
      {links.length > 0 && (
        <p className="github-linkback-help">
          Posting issue context sends the current description and attachment links to GitHub and notifies PR
          subscribers.
          {team?.visibility === "private" ? " The private-team title is omitted." : " The issue title is included."}
        </p>
      )}
      <ul className="github-pr-cards">
        {links.map((pr) => {
          const repository = repositories.find((binding) => binding.id === pr.repositoryBindingId)!;
          const prUrl = githubUrl(pr.url),
            checksUrl = githubUrl(pr.checksUrl);
          const commitUrl = githubUrl(`${repository.url}/commit/${pr.headSha}`);
          return (
            <li
              className="github-pr-card"
              aria-label={`${repository.owner}/${repository.name} PR #${pr.number}`}
              key={pr.id}
            >
              <header>
                <span>
                  {repository.owner}/{repository.name}
                  {repository.private ? " · Private repository" : ""}
                </span>
                <span>#{pr.number}</span>
              </header>
              <h4>
                {prUrl ? (
                  <a href={prUrl} target="_blank" rel="noreferrer">
                    {pr.title}
                  </a>
                ) : (
                  pr.title
                )}
              </h4>
              <p className="github-branches">
                <span>Branch</span> <code>{pr.headRef}</code> <span aria-label="into">→</span> <code>{pr.baseRef}</code>
              </p>
              <PullRequestSignals pr={pr} />
              <PullRequestReviewers
                pr={pr}
                label={`Current-head reviewers for ${repository.owner}/${repository.name} #${pr.number}`}
              />
              <PullRequestPreviews
                pr={pr}
                label={`Preview links for ${repository.owner}/${repository.name} #${pr.number}`}
              />
              <p className="github-observation">
                Last confirmed <time dateTime={pr.observedAt}>{new Date(pr.observedAt).toLocaleString()}</time>
              </p>
              <div className="github-card-actions">
                {checksUrl && (
                  <a href={checksUrl} target="_blank" rel="noreferrer">
                    Open checks
                  </a>
                )}
                {commitUrl && (
                  <a href={commitUrl} target="_blank" rel="noreferrer">
                    View commit
                  </a>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={Boolean(busy)}
                  aria-label={`Refresh PR #${pr.number}`}
                  onClick={() =>
                    void perform(pr.id, async () => {
                      await membershipRequest("/api/integrations/github/pull-requests/refresh", { linkId: pr.id });
                    })
                  }
                >
                  {busy === pr.id ? "Refreshing…" : "Refresh"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={Boolean(busy)}
                  aria-label={`Post issue context to PR #${pr.number}`}
                  onClick={() =>
                    void perform(`linkback:${pr.id}`, async () => {
                      const result = await membershipRequest("/api/integrations/github/pull-requests/linkback", {
                        linkId: pr.id,
                      });
                      const created =
                        result && typeof result === "object" && "created" in result && result.created === true;
                      setLinkbackStatus(
                        created
                          ? `Issue context posted to PR #${pr.number}.`
                          : `Issue context is already on PR #${pr.number}.`,
                      );
                    })
                  }
                >
                  {busy === `linkback:${pr.id}` ? "Posting…" : "Post issue context"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={Boolean(busy)}
                  aria-label={`Unlink PR #${pr.number}`}
                  onClick={() => {
                    try {
                      workspace.unlinkPullRequest(pr.id);
                      setError(null);
                    } catch (failure) {
                      setError(failure instanceof Error ? failure.message : "This pull request could not be unlinked.");
                    }
                  }}
                >
                  Unlink
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      {repositories.length ? (
        <form className="github-link-form" onSubmit={link}>
          <label htmlFor="github-pr-url">Pull request URL</label>
          <Input
            id="github-pr-url"
            type="url"
            value={url}
            placeholder="https://github.com/owner/repository/pull/123"
            onChange={(event) => setUrl(event.target.value)}
            disabled={Boolean(busy)}
          />
          <Button variant="outline" disabled={Boolean(busy) || !url.trim()}>
            {busy === "link" ? "Linking pull request…" : "Link pull request"}
          </Button>
        </form>
      ) : (
        snapshot.context?.mode === "hosted" &&
        snapshot.context.role === "owner" && <a href="#settings/integrations">Connect one in Settings</a>
      )}
    </section>
  );
}
