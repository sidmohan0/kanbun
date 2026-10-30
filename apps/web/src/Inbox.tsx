import { useState } from "react";
import { issueIncarnation } from "@kanbun/sync";
import { workspace, type WorkspaceSnapshot } from "./workspace";

const kind = (type: string) =>
  ({
    assignment: "assigned this issue to you",
    mention: "mentioned you",
    reply: "replied to your comment",
    comment: "commented on an issue you follow",
  })[type] ?? "shared a workspace update";
export function Inbox({ snapshot }: { snapshot: WorkspaceSnapshot }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="inbox-panel" aria-label="Notifications">
      <div className="inbox-heading">
        <h2>Your updates</h2>
        <span>{snapshot.unreadNotificationCount} unread</span>
      </div>
      <p className="description-help">Assignments, mentions, replies, and comments on issues you follow appear here.</p>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {!snapshot.notifications.length ? (
        <div className="empty-state">
          <h3>You’re caught up.</h3>
          <p>No updates in your inbox yet.</p>
        </div>
      ) : (
        <ol className="inbox-list">
          {snapshot.notifications.map((notification) => {
            const issue = snapshot.issues.find(
              (issue) => issue.id === notification.issueId && issueIncarnation(issue) === notification.issueIncarnation,
            );
            const member = snapshot.knownMembers.find((member) => member.id === notification.actorId);
            const actor = member ? member.displayName || member.name : "A teammate";
            return (
              <li key={notification.id} data-notification-id={notification.id} data-unread={!notification.readAt}>
                <div className="inbox-item-content">
                  <p>
                    <strong>{actor}</strong> {kind(notification.type)}
                  </p>
                  {issue ? (
                    <a href={`#issues/${encodeURIComponent(issue.id)}`}>{issue.title}</a>
                  ) : (
                    <span className="description-help">Workspace update</span>
                  )}
                  <time dateTime={notification.createdAt}>{new Date(notification.createdAt).toLocaleString()}</time>
                </div>
                <button
                  className="button quiet compact"
                  disabled={snapshot.phase !== "ready"}
                  onClick={() => {
                    try {
                      workspace.markNotificationRead(notification.id, !notification.readAt);
                      setError(null);
                    } catch (failure) {
                      setError(failure instanceof Error ? failure.message : "This update could not be changed.");
                    }
                  }}
                >
                  {notification.readAt ? "Mark unread" : "Mark read"}
                </button>
              </li>
            );
          })}
        </ol>
      )}
      <p className="description-help">Read changes save in this browser and sync when connected.</p>
    </section>
  );
}
