import { useState } from "react";
import { workspace, type WorkspaceSnapshot } from "./workspace";

export function CodeSettings({ snapshot }: { snapshot: WorkspaceSnapshot }) {
  const [error, setError] = useState<string | null>(null);
  function update(patch: { moveIssueToStartOnBranchCopy?: boolean; autoAssignToSelf?: boolean }) {
    try {
      workspace.updateCodePreferences(patch);
      setError(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The preference could not be saved.");
    }
  }
  return (
    <section aria-label="Code and reviews settings">
      <h2>Code &amp; reviews</h2>
      <label>
        <input
          type="checkbox"
          checked={snapshot.userSettings?.moveIssueToStartOnBranchCopy ?? false}
          onChange={(event) => update({ moveIssueToStartOnBranchCopy: event.target.checked })}
        />{" "}
        Move issues to start when copying a git branch name
      </label>
      <p>
        After a successful copy, move unstarted work to the first Started status in its team. Completed and canceled
        work stays as it is.
      </p>
      <label>
        <input
          type="checkbox"
          checked={snapshot.userSettings?.autoAssignToSelf ?? false}
          onChange={(event) => update({ autoAssignToSelf: event.target.checked })}
        />{" "}
        Assign unassigned issues to me when starting from a branch copy
      </label>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
