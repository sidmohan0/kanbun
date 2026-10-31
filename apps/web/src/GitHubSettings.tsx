import { useEffect, useState, type FormEvent } from "react";
import { workspace, type WorkspaceSnapshot } from "./workspace";
import { membershipRequest } from "./membership";
import {
  githubAuthorizationUrl,
  githubConnection,
  githubInstallationUrl,
  githubUrl,
  type GitHubConnection,
} from "./github";
import "./styles/github.css";

function OwnerGitHubSettings({ snapshot }: { snapshot: WorkspaceSnapshot }) {
  const [connection, setConnection] = useState<GitHubConnection | null>(null);
  const [repository, setRepository] = useState("");
  const [teamId, setTeamId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const selectedTeam = teamId || snapshot.teams[0]?.id || "";
  async function load() {
    const value = githubConnection(await membershipRequest("/api/integrations/github"));
    setConnection(value);
  }
  useEffect(() => {
    let active = true;
    void membershipRequest("/api/integrations/github")
      .then(githubConnection)
      .then((value) => {
        if (active) {
          setConnection(value);
          setError(null);
        }
      })
      .catch((failure: unknown) => {
        if (active) setError(failure instanceof Error ? failure.message : "GitHub connection could not be loaded.");
      });
    return () => {
      active = false;
    };
  }, [attempt]);
  async function perform(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
      await workspace.refresh();
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "GitHub connection could not be changed.");
    } finally {
      setBusy(false);
    }
  }
  async function connect() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await membershipRequest("/api/integrations/github/connect", {});
      const url = result && typeof result === "object" && "url" in result ? githubAuthorizationUrl(result.url) : null;
      if (!url) throw new Error("GitHub returned an invalid authorization destination.");
      location.assign(url);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "GitHub authorization could not start.");
      setBusy(false);
    }
  }
  function bind(event: FormEvent) {
    event.preventDefault();
    const source = connection?.catalog.find((item) => `${item.installationId}:${item.repositoryId}` === repository);
    if (!source || !selectedTeam) return;
    void perform(async () => {
      await membershipRequest("/api/integrations/github/repositories", {
        teamId: selectedTeam,
        installationId: source.installationId,
        repositoryId: source.repositoryId,
      });
      setRepository("");
    });
  }
  const installUrl = githubInstallationUrl(connection?.installUrl);
  return (
    <section className="github-settings" aria-label="GitHub connection">
      <header className="github-section-heading">
        <h2>GitHub</h2>
        <button className="button quiet compact" disabled={busy} onClick={() => setAttempt((value) => value + 1)}>
          Refresh repositories
        </button>
      </header>
      <p>
        Bring pull requests, branches, reviews and checks into the issues they belong to. Connecting GitHub does not
        sign anyone in to Kanbun.
      </p>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {connection?.error && (
        <p className="notice" role="alert">
          {connection.error}
        </p>
      )}
      {!connection && !error && <p role="status">Loading GitHub connection…</p>}
      {connection && !connection.configured && (
        <p>A workspace operator must configure the GitHub App before repositories can be connected.</p>
      )}
      {connection?.configured && (
        <>
          <p>
            {connection.authorizationRequired
              ? "Authorize the GitHub repositories this workspace may use."
              : `Connected to ${connection.appName ?? "the GitHub App"}.`}
          </p>
          <div className="github-connection-actions">
            {installUrl && (
              <a className="button" href={installUrl} target="_blank" rel="noreferrer">
                Install on GitHub
              </a>
            )}
            <button className="button" disabled={busy} onClick={() => void connect()}>
              {busy
                ? "Please wait…"
                : connection.authorizationRequired
                  ? "Connect GitHub"
                  : "Update GitHub authorization"}
            </button>
          </div>
          <form className="github-bind-form" onSubmit={bind}>
            <h3>Share a repository with a team</h3>
            <label htmlFor="github-repository">GitHub repository</label>
            <select
              id="github-repository"
              value={repository}
              disabled={busy}
              onChange={(event) => setRepository(event.target.value)}
            >
              <option value="">Choose a repository</option>
              {connection.catalog.map((source) => (
                <option
                  key={`${source.installationId}:${source.repositoryId}`}
                  value={`${source.installationId}:${source.repositoryId}`}
                >
                  {source.owner}/{source.name}
                  {source.private ? " (private repository)" : ""}
                </option>
              ))}
            </select>
            <label htmlFor="github-team">Kanbun team</label>
            <select
              id="github-team"
              value={selectedTeam}
              disabled={busy}
              onChange={(event) => setTeamId(event.target.value)}
            >
              {!snapshot.teams.length && <option value="">No team available</option>}
              {snapshot.teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                  {team.visibility === "private" ? " (private team)" : " (all workspace members)"}
                </option>
              ))}
            </select>
            <p>
              Linked pull-request metadata will be visible to people who can access issues in this team. This does not
              grant access to GitHub source code.
            </p>
            <button className="button primary" disabled={busy || !repository || !selectedTeam}>
              Connect repository to team
            </button>
          </form>
          {!connection.catalog.length && (
            <p>
              No authorized repositories are available. Install the App for selected repositories, then update GitHub
              authorization.
            </p>
          )}
          <h3>Connected repositories</h3>
          {!connection.repositories.length && <p>No repositories are connected to a Kanbun team yet.</p>}
          <ul className="github-binding-list">
            {connection.repositories.map((binding) => (
              <li key={binding.id}>
                <div>
                  {githubUrl(binding.url) ? (
                    <a href={githubUrl(binding.url)!} target="_blank" rel="noreferrer">
                      {binding.owner}/{binding.name}
                    </a>
                  ) : (
                    <strong>
                      {binding.owner}/{binding.name}
                    </strong>
                  )}
                  <span>
                    {snapshot.teams.find((team) => team.id === binding.teamId)?.name ?? "Unavailable team"}
                    {binding.private ? " · Private repository" : ""}
                  </span>
                </div>
                <button
                  className="button quiet compact"
                  disabled={busy}
                  aria-label={`Disconnect ${binding.owner}/${binding.name} from ${snapshot.teams.find((team) => team.id === binding.teamId)?.name ?? "team"}`}
                  onClick={() =>
                    void perform(async () => {
                      await membershipRequest("/api/integrations/github/repositories/disconnect", {
                        bindingId: binding.id,
                      });
                    })
                  }
                >
                  Disconnect
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
/** Members never request the owner's private repository catalog. */
export function GitHubSettings({ snapshot }: { snapshot: WorkspaceSnapshot }) {
  return snapshot.context?.mode === "hosted" && snapshot.context.role === "owner" ? (
    <OwnerGitHubSettings snapshot={snapshot} />
  ) : null;
}
