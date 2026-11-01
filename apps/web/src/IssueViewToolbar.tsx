import { Input } from "./components/ui/input";
import { Button } from "./components/ui/button";
import type { WorkspaceSnapshot } from "./workspace";
import { emptyIssueFilters, type IssueFilters, type IssueOrder, type IssueView } from "./issueViews";

export function IssueViewToolbar({
  view,
  filters,
  snapshot,
  onChange,
}: {
  view: IssueView;
  filters: IssueFilters;
  snapshot: WorkspaceSnapshot;
  onChange(filters: IssueFilters): void;
}) {
  const ready = snapshot.phase === "ready";
  const labels = snapshot.labels.filter((label) => !label.isGroup);
  const teamKeys = new Map(snapshot.teams.map((team) => [team.id, team.key]));
  const active =
    filters.search ||
    filters.stateId ||
    filters.assigneeId ||
    filters.priority ||
    filters.labelId ||
    filters.order !== "manual";
  const change = (patch: Partial<IssueFilters>) => onChange({ ...filters, ...patch });
  return (
    <section className="issue-view-toolbar" aria-label="Issue filters">
      <label className="view-search" htmlFor="issue-search">
        Search issues
        <Input
          id="issue-search"
          type="search"
          placeholder="Search identifier, title, or description"
          value={filters.search}
          disabled={!ready}
          onChange={(event) => change({ search: event.target.value })}
        />
      </label>
      <div className="view-filter-fields">
        <label htmlFor="filter-state">
          Filter by status
          <select
            id="filter-state"
            value={filters.stateId}
            disabled={!ready}
            onChange={(event) => change({ stateId: event.target.value })}
          >
            <option value="">Any status</option>
            {filters.stateId && !snapshot.workflowStates.some((state) => state.id === filters.stateId) && (
              <option value={filters.stateId} disabled>
                Unavailable status
              </option>
            )}
            {snapshot.workflowStates.map((state) => (
              <option key={state.id} value={state.id}>
                {snapshot.teams.length > 1 ? `${teamKeys.get(state.teamId) ?? "Team"} · ` : ""}
                {state.name}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="filter-assignee">
          Filter by assignee
          <select
            id="filter-assignee"
            value={view === "mine" ? (snapshot.context?.actor.id ?? "") : filters.assigneeId}
            disabled={!ready || view === "mine"}
            onChange={(event) => change({ assigneeId: event.target.value })}
          >
            {view === "mine" ? (
              <option value={snapshot.context?.actor.id ?? ""}>Assigned to me</option>
            ) : (
              <>
                <option value="">Anyone</option>
                <option value="unassigned">Unassigned</option>
                {filters.assigneeId &&
                  filters.assigneeId !== "unassigned" &&
                  !snapshot.members.some((member) => member.id === filters.assigneeId) && (
                    <option value={filters.assigneeId} disabled>
                      Unavailable member
                    </option>
                  )}
                {snapshot.members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.displayName || member.name}
                  </option>
                ))}
              </>
            )}
          </select>
        </label>
        <label htmlFor="filter-priority">
          Filter by priority
          <select
            id="filter-priority"
            value={filters.priority}
            disabled={!ready}
            onChange={(event) => change({ priority: event.target.value })}
          >
            <option value="">Any priority</option>
            <option value="0">None</option>
            <option value="1">Urgent</option>
            <option value="2">High</option>
            <option value="3">Medium</option>
            <option value="4">Low</option>
          </select>
        </label>
        <label htmlFor="filter-label">
          Filter by label
          <select
            id="filter-label"
            value={filters.labelId}
            disabled={!ready}
            onChange={(event) => change({ labelId: event.target.value })}
          >
            <option value="">Any label</option>
            {filters.labelId && !labels.some((label) => label.id === filters.labelId) && (
              <option value={filters.labelId} disabled>
                Unavailable label
              </option>
            )}
            {labels.map((label) => (
              <option key={label.id} value={label.id}>
                {snapshot.teams.length > 1 && label.teamId ? `${teamKeys.get(label.teamId) ?? "Team"} · ` : ""}
                {label.name}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="issue-order">
          Sort issues
          <select
            id="issue-order"
            value={filters.order}
            disabled={!ready}
            onChange={(event) => change({ order: event.target.value as IssueOrder })}
          >
            <option value="manual">Manual order</option>
            <option value="priority">Priority</option>
            <option value="newest">Newest first</option>
            <option value="updated">Recently updated</option>
            <option value="title">Title</option>
          </select>
        </label>
        <Button
          variant="ghost"
          size="sm"
          className="clear-view-filters"
          disabled={!ready || !active}
          onClick={() => onChange(emptyIssueFilters())}
        >
          Clear filters
        </Button>
      </div>
    </section>
  );
}
