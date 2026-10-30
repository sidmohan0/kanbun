import { useEffect, useState } from "react";
import { workspaceContextSchema } from "@kanbun/sync";
import { Mark } from "./brand/Mark";
import { MembershipError, membershipRequest } from "./membership";

type InvitationDetails = { email: string; workspaceName: string; expiresAt: string | null; accepted: boolean };
function enterWorkspace() {
  // Replace the bearer fragment before reloading a fresh, server-verified workspace identity.
  history.replaceState(null, "", "#issues");
  location.reload();
}
export function Invitation({ token }: { token: string }) {
  const [details, setDetails] = useState<InvitationDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signInRequired, setSignInRequired] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void membershipRequest("/api/invitations/inspect", { token })
      .then((value) => {
        if (!active) return;
        if (
          value === null ||
          typeof value !== "object" ||
          !("email" in value) ||
          typeof value.email !== "string" ||
          !("workspaceName" in value) ||
          typeof value.workspaceName !== "string" ||
          !("accepted" in value) ||
          typeof value.accepted !== "boolean" ||
          !("expiresAt" in value) ||
          (value.expiresAt !== null && typeof value.expiresAt !== "string")
        )
          throw new Error("The server returned an invalid invitation.");
        setDetails(value as InvitationDetails);
      })
      .catch((failure: unknown) => {
        if (active) {
          setSignInRequired(failure instanceof MembershipError && failure.status === 401);
          setError(failure instanceof Error ? failure.message : "This invitation could not be opened.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token, attempt]);
  async function accept() {
    setAccepting(true);
    setError(null);
    try {
      const result = workspaceContextSchema.safeParse(await membershipRequest("/api/invitations/accept", { token }));
      if (!result.success) throw new Error("The server returned an invalid workspace identity.");
      enterWorkspace();
    } catch (failure) {
      setSignInRequired(failure instanceof MembershipError && failure.status === 401);
      setError(failure instanceof Error ? failure.message : "This invitation could not be accepted.");
      setAccepting(false);
    }
  }
  return (
    <main className="invitation-shell">
      <div className="invitation-card">
        <div className="brand-lockup">
          <Mark size={28} />
          <span>kanbun</span>
        </div>
        <p className="eyebrow">WORKSPACE INVITATION</p>
        <h1>
          {signInRequired
            ? "Sign in to accept your invitation"
            : details
              ? `Join ${details.workspaceName}`
              : "Your invitation"}
        </h1>
        {loading && <p>Checking your invitation…</p>}
        {error && (
          <div className="notice" role="alert">
            {error}
          </div>
        )}
        {error && (
          <button
            className="button"
            disabled={loading || accepting}
            onClick={() => {
              if (signInRequired) location.reload();
              else {
                setLoading(true);
                setDetails(null);
                setError(null);
                setSignInRequired(false);
                setAttempt((value) => value + 1);
              }
            }}
          >
            {signInRequired ? "Sign in again" : "Check invitation again"}
          </button>
        )}
        {details && (
          <>
            <p>
              This invitation is for <strong>{details.email}</strong>. Use that account to join this workspace.
            </p>
            {details.expiresAt && (
              <p className="members-description">Expires {new Date(details.expiresAt).toLocaleString()}.</p>
            )}
            {details.accepted ? (
              <>
                <p>You have already accepted this invitation.</p>
                <button className="button primary" onClick={enterWorkspace}>
                  Open workspace
                </button>
              </>
            ) : (
              !signInRequired && (
                <button className="button primary" disabled={accepting} onClick={() => void accept()}>
                  {accepting ? "Joining workspace…" : "Accept invitation"}
                </button>
              )
            )}
          </>
        )}
        {!loading && !details && (
          <p className="members-description">
            Sign in with the invited email and reopen the link. Ask the workspace owner for a new invitation if this one
            is no longer valid.
          </p>
        )}
        <p className="members-description">
          No separate Kanbun registration is needed. Use the email your workspace owner invited. To use a different
          account, open this complete invitation link in a private browser window and sign in there.
        </p>
      </div>
    </main>
  );
}
