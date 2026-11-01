import { Textarea } from "./components/ui/textarea";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { NativeSelect } from "./components/ui/native-select";
import { useEffect, useState, type FormEvent } from "react";
import { WORKFLOW_STATE_TYPES, type Row, type WorkflowStateType } from "@kanbun/model";
import { DEFAULT_STATES } from "@kanbun/mutators";
import { workspace, type WorkspaceSnapshot } from "./workspace";
import "./styles/teams.css";
import { GitHubSettings } from "./GitHubSettings";

const categoryName: Record<WorkflowStateType, string> = {
  triage: "Triage",
  backlog: "Backlog",
  unstarted: "Todo",
  started: "In progress",
  completed: "Done",
  canceled: "Canceled",
};
const message = (failure: unknown) => (failure instanceof Error ? failure.message : "This change could not be saved.");

function StateRow({
  state,
  first,
  last,
  move,
  failed,
}: {
  state: Row<"workflowState">;
  first: boolean;
  last: boolean;
  move(direction: number): void;
  failed(failure: unknown): void;
}) {
  const [name, setName] = useState(state.name);
  function save(event: FormEvent) {
    event.preventDefault();
    try {
      workspace.renameWorkflowState(state.id, name.trim());
    } catch (failure) {
      failed(failure);
    }
  }
  return (
    <li className="workflow-state-row">
      <form onSubmit={save}>
        <label htmlFor={`state-${state.id}`}>Name for {state.name}</label>
        <Input
          id={`state-${state.id}`}
          value={name}
          maxLength={40}
          required
          onChange={(event) => setName(event.target.value)}
        />
        <Button
          variant="ghost"
          size="sm"
          className="button quiet compact"
          disabled={!name.trim() || name.trim() === state.name}
        >
          Save status
        </Button>
      </form>
      <div className="workflow-order">
        <Button
          variant="ghost"
          size="sm"
          className="button quiet compact"
          aria-label={`Move ${state.name} up`}
          disabled={first}
          onClick={() => move(-1)}
        >
          ↑
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="button quiet compact"
          aria-label={`Move ${state.name} down`}
          disabled={last}
          onClick={() => move(1)}
        >
          ↓
        </Button>
      </div>
    </li>
  );
}

function TeamEditor({
  team,
  states,
  failed,
  section,
}: {
  section: "teams" | "workflow";
  team: Row<"team">;
  states: Row<"workflowState">[];
  failed(failure: unknown): void;
}) {
  const [name, setName] = useState(team.name);
  const [key, setKey] = useState(team.key);
  const [description, setDescription] = useState(team.description ?? "");
  const [stateName, setStateName] = useState("");
  const [stateType, setStateType] = useState<WorkflowStateType>("started");
  const [defaultState, setDefaultState] = useState(team.defaultIssueStateId ?? "");
  function save(event: FormEvent) {
    event.preventDefault();
    try {
      workspace.updateTeam(team.id, {
        name: name.trim(),
        key: key.trim(),
        displayName: name.trim(),
        description: description.trim() || null,
        ...(defaultState ? { defaultIssueStateId: defaultState } : {}),
      });
    } catch (failure) {
      failed(failure);
    }
  }
  function createState(event: FormEvent) {
    event.preventDefault();
    try {
      const color = DEFAULT_STATES.find((state) => state.type === stateType)!.color;
      workspace.createWorkflowState(team.id, stateName.trim(), stateType, color);
      setStateName("");
    } catch (failure) {
      failed(failure);
    }
  }
  function move(type: WorkflowStateType, stateId: string, direction: number) {
    const ordered = states.filter((state) => state.type === type).map((state) => state.id);
    const index = ordered.indexOf(stateId);
    const other = index + direction;
    if (index < 0 || other < 0 || other >= ordered.length) return;
    [ordered[index], ordered[other]] = [ordered[other]!, ordered[index]!];
    try {
      workspace.reorderWorkflowStates(team.id, type, ordered);
    } catch (failure) {
      failed(failure);
    }
  }
  return (
    <section className="team-editor" aria-label={`Settings for ${team.name}`}>
      <h2>
        {team.name} <span className="team-key">{team.key}</span>
      </h2>
      <p>
        {team.visibility === "private"
          ? "Private team. Existing membership restrictions still apply."
          : "Available to everyone in this workspace."}
      </p>
      <form className="team-form" hidden={section !== "teams"} onSubmit={save}>
        <label htmlFor="team-name">Team name</label>
        <Input id="team-name" value={name} required maxLength={80} onChange={(event) => setName(event.target.value)} />
        <label htmlFor="team-key">Team key</label>
        <Input
          id="team-key"
          value={key}
          required
          maxLength={7}
          pattern="[A-Za-z][A-Za-z0-9]{0,6}"
          aria-describedby="team-key-help"
          onChange={(event) => setKey(event.target.value.toUpperCase())}
        />
        <p id="team-key-help">
          Changing the key updates existing issue identifiers. Issue links and numbers stay the same.
        </p>
        <label htmlFor="team-description">Team description</label>
        <Textarea id="team-description" value={description} onChange={(event) => setDescription(event.target.value)} />
        <label htmlFor="default-status">Default status for new issues</label>
        <NativeSelect
          id="default-status"
          value={defaultState}
          onChange={(event) => setDefaultState(event.target.value)}
        >
          {states.map((state) => (
            <option key={state.id} value={state.id}>
              {state.name}
            </option>
          ))}
        </NativeSelect>
        <Button className="button primary" disabled={!name.trim() || !key.trim()}>
          Save team settings
        </Button>
      </form>
      <div hidden={section !== "workflow"}>
        <h3>Workflow statuses</h3>
        {WORKFLOW_STATE_TYPES.map((type) => {
          const category = states.filter((state) => state.type === type);
          return category.length ? (
            <section className="workflow-category" key={type} aria-label={`${categoryName[type]} statuses`}>
              <h4>{categoryName[type]}</h4>
              <ol>
                {category.map((state, index) => (
                  <StateRow
                    key={`${state.id}:${state.name}`}
                    state={state}
                    first={index === 0}
                    last={index === category.length - 1}
                    failed={failed}
                    move={(direction) => move(type, state.id, direction)}
                  />
                ))}
              </ol>
            </section>
          ) : null;
        })}
        <form className="team-form" onSubmit={createState}>
          <h3>Add a status</h3>
          <label htmlFor="new-status-name">New status name</label>
          <Input
            id="new-status-name"
            value={stateName}
            required
            maxLength={40}
            onChange={(event) => setStateName(event.target.value)}
          />
          <label htmlFor="status-category">Status category</label>
          <NativeSelect
            id="status-category"
            value={stateType}
            onChange={(event) => setStateType(event.target.value as WorkflowStateType)}
          >
            {WORKFLOW_STATE_TYPES.map((type) => (
              <option key={type} value={type}>
                {categoryName[type]}
              </option>
            ))}
          </NativeSelect>
          <Button className="button primary" disabled={!stateName.trim()}>
            Add status
          </Button>
        </form>
      </div>
    </section>
  );
}

function WorkspaceName({ name }: { name: string }) {
  const [draft, setDraft] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await workspace.renameWorkspace(draft.trim());
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="team-form team-create" onSubmit={(event) => void save(event)} aria-label="Workspace name settings">
      <h2>Workspace</h2>
      <p>An internet connection is required to rename the workspace.</p>
      <label htmlFor="workspace-name">Workspace name</label>
      <Input id="workspace-name" value={draft} required onChange={(event) => setDraft(event.target.value)} />
      <Button className="button primary" disabled={busy || !draft.trim() || draft.trim() === name}>
        {busy ? "Saving workspace name…" : "Save workspace name"}
      </Button>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

export function TeamSettings({ snapshot }: { snapshot: WorkspaceSnapshot }) {
  const [section, setSection] = useState<"workspace" | "integrations" | "teams" | "workflow">(() => {
    try {
      if (snapshot.context?.mode !== "hosted") return "teams";
      if (location.hash === "#settings/integrations") return "integrations";
      const saved = sessionStorage.getItem("kanbun:settings-section");
      return saved === "workspace" || saved === "integrations" || saved === "workflow" ? saved : "teams";
    } catch {
      return "teams";
    }
  });
  useEffect(() => {
    try {
      sessionStorage.setItem("kanbun:settings-section", section);
    } catch {
      /* Optional preference. */
    }
  }, [section]);
  function selectSection(next: "workspace" | "integrations" | "teams" | "workflow") {
    setSection(next);
    history.replaceState(null, "", next === "integrations" ? "#settings/integrations" : "#settings");
  }
  const [selected, setSelected] = useState("");
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const teams = snapshot.teams.filter(
    (team) =>
      team.visibility === "public" ||
      snapshot.teamMemberships.some(
        (membership) => membership.teamId === team.id && membership.userId === snapshot.context?.actor.id,
      ),
  );
  const team = teams.find((candidate) => candidate.id === selected) ?? teams[0];
  const states = snapshot.workflowStates.filter((state) => state.teamId === team?.id);
  const failed = (failure: unknown) => setError(message(failure));
  function create(event: FormEvent) {
    event.preventDefault();
    try {
      setSelected(workspace.createTeam(name.trim(), key.trim()));
      setName("");
      setKey("");
      setError(null);
    } catch (failure) {
      failed(failure);
    }
  }
  return (
    <section className="teams-settings" aria-label="Team and workflow settings">
      <nav className="settings-nav" aria-label="Settings sections">
        {snapshot.context?.mode === "hosted" && snapshot.context.role === "owner" && (
          <a className="button quiet compact" href="#members">
            Members
          </a>
        )}
        {snapshot.context?.mode === "hosted" && (
          <Button
            variant="ghost"
            size="sm"
            className="button quiet compact"
            aria-pressed={section === "workspace"}
            onClick={() => selectSection("workspace")}
          >
            Workspace
          </Button>
        )}
        {snapshot.context?.mode === "hosted" && (
          <Button
            variant="ghost"
            size="sm"
            className="button quiet compact"
            aria-pressed={section === "integrations"}
            onClick={() => selectSection("integrations")}
          >
            Integrations
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="button quiet compact"
          aria-pressed={section === "teams"}
          onClick={() => selectSection("teams")}
        >
          Teams
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="button quiet compact"
          aria-pressed={section === "workflow"}
          onClick={() => selectSection("workflow")}
        >
          Workflow
        </Button>
      </nav>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {snapshot.context?.mode === "hosted" && (
        <div hidden={section !== "workspace"}>
          <WorkspaceName name={snapshot.context.workspaceName} />
        </div>
      )}
      <div hidden={section !== "integrations"}>
        <GitHubSettings snapshot={snapshot} />
      </div>
      <div hidden={section !== "teams" && section !== "workflow"} className="settings-team-section">
        <h2>Teams</h2>
        <label htmlFor="settings-team">Choose a team</label>
        <NativeSelect
          id="settings-team"
          value={team?.id ?? ""}
          onChange={(event) => {
            setSelected(event.target.value);
            setError(null);
          }}
        >
          {teams.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name} ({candidate.key})
            </option>
          ))}
        </NativeSelect>
        {team && (
          <TeamEditor
            key={team.id}
            team={team}
            states={states}
            failed={failed}
            section={section === "workflow" ? "workflow" : "teams"}
          />
        )}
        <form className="team-form team-create" hidden={section !== "teams"} onSubmit={create}>
          <h2>Create a team</h2>
          <p>New teams are available to everyone in this workspace.</p>
          <label htmlFor="new-team-name">New team name</label>
          <Input
            id="new-team-name"
            value={name}
            required
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
          />
          <label htmlFor="new-team-key">New team key</label>
          <Input
            id="new-team-key"
            value={key}
            required
            maxLength={7}
            pattern="[A-Za-z][A-Za-z0-9]{0,6}"
            onChange={(event) => setKey(event.target.value.toUpperCase())}
          />
          <Button className="button primary" disabled={!name.trim() || !key.trim()}>
            Create team
          </Button>
        </form>
      </div>
    </section>
  );
}
