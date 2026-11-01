import { useState } from "react";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "./components/ui/popover";
import type { Row } from "@kanbun/model";
import { workspace, type WorkspaceSnapshot } from "./workspace";

const priorities = [
  [0, "None"],
  [1, "Urgent"],
  [2, "High"],
  [3, "Medium"],
  [4, "Low"],
] as const;

export function IssueProperties({
  issue,
  snapshot,
  onArchive,
}: {
  issue: Row<"issue">;
  snapshot: WorkspaceSnapshot;
  onArchive(issue: Row<"issue">): void;
}) {
  const [newLabel, setNewLabel] = useState("");
  const [creatingLabel, setCreatingLabel] = useState(false);
  const [labelSearch, setLabelSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const states = snapshot.workflowStates.filter((state) => state.teamId === issue.teamId);
  const team = snapshot.teams.find((candidate) => candidate.id === issue.teamId);
  const eligibleMembers = snapshot.members.filter(
    (member) =>
      team?.visibility !== "private" ||
      snapshot.teamMemberships.some(
        (membership) => membership.teamId === issue.teamId && membership.userId === member.id,
      ),
  );
  const labels = snapshot.labels.filter((label) => !label.isGroup && (!label.teamId || label.teamId === issue.teamId));
  const applied = new Set(snapshot.labelLinks.filter((link) => link.issueId === issue.id).map((link) => link.labelId));
  const available = labels.filter((label) => !applied.has(label.id));
  function change(action: () => void) {
    try {
      action();
      setError(null);
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "This change could not be saved.");
      return false;
    }
  }
  return (
    <section className="issue-properties" aria-label="Issue properties">
      <div className="property-fields">
        <label className="property-field" htmlFor="issue-state">
          Status
          <select
            id="issue-state"
            value={issue.stateId}
            onChange={(event) => change(() => workspace.updateIssue(issue.id, { stateId: event.target.value }))}
          >
            {!states.some((state) => state.id === issue.stateId) && (
              <option value={issue.stateId} disabled>
                Unavailable status
              </option>
            )}
            {states.map((state) => (
              <option key={state.id} value={state.id}>
                {state.name}
              </option>
            ))}
          </select>
        </label>
        <label className="property-field" htmlFor="issue-priority">
          Priority
          <select
            id="issue-priority"
            value={issue.priority}
            onChange={(event) =>
              change(() =>
                workspace.updateIssue(issue.id, { priority: Number(event.target.value) as 0 | 1 | 2 | 3 | 4 }),
              )
            }
          >
            {priorities.map(([value, name]) => (
              <option key={value} value={value}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="property-field" htmlFor="issue-assignee">
          Assignee
          <select
            id="issue-assignee"
            value={issue.assigneeId ?? ""}
            onChange={(event) =>
              change(() => workspace.updateIssue(issue.id, { assigneeId: event.target.value || null }))
            }
          >
            <option value="">Unassigned</option>
            {issue.assigneeId && !eligibleMembers.some((member) => member.id === issue.assigneeId) && (
              <option value={issue.assigneeId} disabled>
                Unavailable assignee
              </option>
            )}
            {eligibleMembers.map((member) => (
              <option key={member.id} value={member.id}>
                {member.displayName || member.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {issue.assertedStateId && (
        <button className="button quiet compact" onClick={() => change(() => workspace.clearIssueStatus(issue.id))}>
          Clear status override
        </button>
      )}
      <div className="property-labels">
        <span className="property-label-title">Labels</span>
        <div className="label-chips">
          {labels
            .filter((label) => applied.has(label.id))
            .map((label) => (
              <button
                key={label.id}
                className="label-chip"
                aria-label={`Remove label ${label.name}`}
                onClick={() => change(() => workspace.setIssueLabel(issue.id, label.id, false))}
              >
                {label.name} <span aria-hidden="true">×</span>
              </button>
            ))}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm">
                + Add label
              </Button>
            </PopoverTrigger>
            <PopoverContent className="label-picker" align="start">
              <Input
                type="search"
                aria-label="Search labels"
                placeholder="Search labels"
                value={labelSearch}
                onChange={(event) => setLabelSearch(event.target.value)}
              />
              <select
                className="add-label"
                aria-label="Add label"
                value=""
                disabled={!available.length}
                onChange={(event) => {
                  if (event.target.value) change(() => workspace.setIssueLabel(issue.id, event.target.value, true));
                }}
              >
                <option value="">
                  {available.length ? "+ Add label" : labels.length ? "All labels applied" : "No labels available"}
                </option>
                {available
                  .filter((label) => label.name.toLowerCase().includes(labelSearch.toLowerCase().trim()))
                  .map((label) => (
                    <option key={label.id} value={label.id}>
                      {label.name}
                    </option>
                  ))}
              </select>
            </PopoverContent>
          </Popover>
          <button
            className="button quiet compact"
            onClick={() => {
              setCreatingLabel(true);
              setError(null);
            }}
          >
            Create label
          </button>
        </div>
        {creatingLabel && (
          <form
            className="new-label-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (change(() => workspace.createIssueLabel(issue.id, issue.teamId, newLabel))) {
                setNewLabel("");
                setCreatingLabel(false);
              }
            }}
          >
            <label htmlFor="new-label-name">New label name</label>
            <div className="new-label-controls">
              <input
                id="new-label-name"
                value={newLabel}
                maxLength={60}
                onChange={(event) => setNewLabel(event.target.value)}
                autoFocus
              />
              <button className="button compact" type="submit" disabled={!newLabel.trim()}>
                Create and apply label
              </button>
              <button
                className="button quiet compact"
                type="button"
                onClick={() => {
                  setCreatingLabel(false);
                  setError(null);
                }}
              >
                Cancel label creation
              </button>
            </div>
          </form>
        )}
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <div className="issue-archive-action">
        <button
          className="button quiet compact"
          onClick={() =>
            change(() => {
              workspace.archiveIssue(issue.id, true);
              onArchive(issue);
            })
          }
        >
          Archive issue
        </button>
        <span>Archived issues leave the active list.</span>
      </div>
    </section>
  );
}
