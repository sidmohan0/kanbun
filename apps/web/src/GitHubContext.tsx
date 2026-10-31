import { useState, type FormEvent } from "react";
import type { Row } from "@kanbun/model";
import { issueIncarnation } from "@kanbun/sync";
import { membershipRequest } from "./membership";
import { workspace, type WorkspaceSnapshot } from "./workspace";
import { checksLabel, checksStatus, githubUrl, pullRequestLocation, reviewLabel, reviewStatus } from "./github";
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
        <span>GitHub context</span>
      </header>
      <p>Checks and reviews describe the current commit. GitHub controls merge requirements.</p>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {!links.length && repositories.length > 0 && <p>No pull requests linked to this issue yet.</p>}
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
                <button
                  className="button quiet compact"
                  disabled={Boolean(busy)}
                  aria-label={`Refresh PR #${pr.number}`}
                  onClick={() =>
                    void perform(pr.id, async () => {
                      await membershipRequest("/api/integrations/github/pull-requests/refresh", { linkId: pr.id });
                    })
                  }
                >
                  {busy === pr.id ? "Refreshing…" : "Refresh"}
                </button>
                <button
                  className="button quiet compact"
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
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {repositories.length ? (
        <form className="github-link-form" onSubmit={link}>
          <label htmlFor="github-pr-url">Pull request URL</label>
          <input
            id="github-pr-url"
            type="url"
            value={url}
            placeholder="https://github.com/owner/repository/pull/123"
            onChange={(event) => setUrl(event.target.value)}
            disabled={Boolean(busy)}
          />
          <button className="button" disabled={Boolean(busy) || !url.trim()}>
            {busy === "link" ? "Linking pull request…" : "Link pull request"}
          </button>
          <p>Linking and refreshing require a connection. GitHub permissions still apply when opening source links.</p>
        </form>
      ) : (
        <p>
          No GitHub repository is connected to this team.
          {snapshot.context?.mode === "hosted" && snapshot.context.role === "owner" ? (
            <>
              {" "}
              <a href="#settings">Connect one in Settings</a>.
            </>
          ) : (
            " Ask your workspace owner to connect a repository."
          )}
        </p>
      )}
    </section>
  );
}
