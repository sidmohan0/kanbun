import { useState } from "react";
import type { WorkspaceSnapshot } from "./workspace";

export function mentionCandidates(snapshot: WorkspaceSnapshot, teamId: string | null) {
  const team = snapshot.teams.find((team) => team.id === teamId);
  return snapshot.members.filter(
    (member) =>
      team &&
      (team.visibility !== "private" ||
        snapshot.teamMemberships.some((membership) => membership.teamId === teamId && membership.userId === member.id)),
  );
}
export function validateMentions(snapshot: WorkspaceSnapshot, teamId: string | null, selected: string[]) {
  const eligible = new Set(mentionCandidates(snapshot, teamId).map((member) => member.id));
  if (selected.some((id) => !eligible.has(id)))
    throw new Error("Remove unavailable mentions before submitting this comment.");
}
export function MentionPicker({
  id,
  teamId,
  snapshot,
  selected,
  onChange,
}: {
  id: string;
  teamId: string | null;
  snapshot: WorkspaceSnapshot;
  selected: string[];
  onChange(ids: string[]): void;
}) {
  const [candidate, setCandidate] = useState("");
  const available = mentionCandidates(snapshot, teamId).filter(
    (member) => member.id !== snapshot.context?.actor.id && !selected.includes(member.id),
  );
  return (
    <details className="mention-picker" open={selected.length > 0 || undefined}>
      <summary>Mention teammates{selected.length ? ` (${selected.length})` : ""}</summary>
      <div className="mention-controls">
        <select
          id={`mention-${id}`}
          aria-label="Mention teammate"
          value={candidate}
          onChange={(event) => setCandidate(event.target.value)}
        >
          <option value="">Choose a teammate</option>
          {available.map((member) => (
            <option key={member.id} value={member.id}>
              {member.displayName || member.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="button quiet compact"
          disabled={!available.some((member) => member.id === candidate)}
          onClick={() => {
            onChange([...selected, candidate]);
            setCandidate("");
          }}
        >
          Add mention
        </button>
      </div>
      {selected.length > 0 && (
        <ul className="mention-recipients" aria-label="Mention recipients">
          {selected.map((userId) => {
            const member = snapshot.knownMembers.find((member) => member.id === userId);
            const name = member ? member.displayName || member.name : "Unavailable teammate";
            const unavailable = !mentionCandidates(snapshot, teamId).some((member) => member.id === userId);
            return (
              <li key={userId}>
                <span>
                  {name}
                  {unavailable ? " (unavailable)" : ""}
                </span>
                <button
                  type="button"
                  className="button quiet compact"
                  aria-label={`Remove mention of ${name}`}
                  onClick={() => onChange(selected.filter((id) => id !== userId))}
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="description-help">
        Selected people receive a mention. Typing a name in the text alone does not notify them.
      </p>
    </details>
  );
}
