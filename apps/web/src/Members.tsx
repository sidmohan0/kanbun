import { useCallback, useEffect, useState, type FormEvent } from "react";
import { MembershipError, membershipList, membershipRequest, type MembershipList } from "./membership";
import { workspace } from "./workspace";

export function Members() {
  const [data, setData] = useState<MembershipList | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string; url: string } | null>(null);
  const [copyStatus, setCopyStatus] = useState("");
  const load = useCallback(() => membershipRequest("/api/members").then(membershipList), []);
  const loaded = useCallback((value: MembershipList) => {
    setData(value);
    setError(null);
    setLoading(false);
  }, []);
  const failed = useCallback((failure: unknown) => {
    if (failure instanceof MembershipError && (failure.status === 401 || failure.status === 403))
      workspace.requireAuthentication();
    setError(failure instanceof Error ? failure.message : "The members could not be loaded.");
    setLoading(false);
  }, []);
  useEffect(() => {
    let active = true;
    void load().then(
      (value) => {
        if (active) loaded(value);
      },
      (failure: unknown) => {
        if (active) failed(failure);
      },
    );
    return () => {
      active = false;
    };
  }, [load, loaded, failed]);

  async function perform(name: string, action: () => Promise<void>) {
    if (busy) return;
    setBusy(name);
    setError(null);
    try {
      await action();
      loaded(await load());
    } catch (failure) {
      if (failure instanceof MembershipError && failure.status === 401) workspace.requireAuthentication();
      setError(failure instanceof Error ? failure.message : "This change could not be saved.");
    } finally {
      setBusy(null);
    }
  }
  function invite(event: FormEvent) {
    event.preventDefault();
    const recipient = email.trim().toLowerCase();
    if (!recipient) return;
    void perform("invite", async () => {
      const result = await membershipRequest("/api/invitations", { email: recipient });
      if (
        result === null ||
        typeof result !== "object" ||
        !("token" in result) ||
        typeof result.token !== "string" ||
        !("url" in result) ||
        typeof result.url !== "string" ||
        !("invitation" in result) ||
        result.invitation === null ||
        typeof result.invitation !== "object" ||
        !("id" in result.invitation) ||
        typeof result.invitation.id !== "string"
      )
        throw new Error("The server returned an invalid invitation.");
      setCreated({ id: result.invitation.id, url: result.url });
      setEmail("");
      setCopyStatus("");
    });
  }
  const createdIsPending =
    created &&
    data?.invitations.some(
      (invitation) => invitation.id === created.id && !invitation.acceptedAt && !invitation.revokedAt,
    );
  return (
    <section className="members-panel" aria-label="Workspace members">
      <div className="members-heading">
        <h2>People with access</h2>
        <button
          className="button quiet compact"
          disabled={loading || Boolean(busy)}
          onClick={() => {
            setLoading(true);
            void load().then(loaded, failed);
          }}
        >
          Refresh members
        </button>
      </div>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {loading && !data ? (
        <p>Loading members…</p>
      ) : (
        data && (
          <>
            <ul className="member-list" aria-label="Members">
              {data.members.map((member) => (
                <li key={member.userId}>
                  <div>
                    <strong>{member.name}</strong>
                    <span>{member.email}</span>
                  </div>
                  <span className="member-role">
                    {member.role === "owner" ? "Owner" : "Member"}
                    {!member.active && " · inactive"}
                  </span>
                  {member.role !== "owner" && (
                    <button
                      className="button quiet compact"
                      disabled={Boolean(busy)}
                      aria-label={`Remove member ${member.email}`}
                      onClick={() =>
                        void perform(`remove:${member.userId}`, async () => {
                          await membershipRequest("/api/members/remove", { userId: member.userId });
                        })
                      }
                    >
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <details className="invite-disclosure">
              <summary className="button compact">Invite member</summary>
              <form className="invite-form" onSubmit={invite}>
                <label htmlFor="invite-email">Invite by email</label>
                <div className="invite-controls">
                  <input
                    id="invite-email"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="teammate@example.com"
                    disabled={Boolean(busy)}
                  />
                  <button className="button primary" disabled={Boolean(busy) || !email.trim()} type="submit">
                    {busy === "invite" ? "Creating invitation…" : "Create invitation"}
                  </button>
                </div>
                <p>The invitation only works for this email. Share its link directly with that person.</p>
              </form>
            </details>
            {createdIsPending && (
              <div className="created-invitation">
                <label htmlFor="invitation-link">Invitation link</label>
                <input id="invitation-link" readOnly value={created!.url} />
                <div className="invite-copy">
                  <button
                    className="button compact"
                    onClick={() => {
                      if (!navigator.clipboard?.writeText) {
                        setCopyStatus("Copy unavailable. Select the invitation link and copy it manually.");
                        return;
                      }
                      void navigator.clipboard.writeText(created!.url).then(
                        () => setCopyStatus("Invitation link copied."),
                        () => setCopyStatus("Copy unavailable. Select the invitation link and copy it manually."),
                      );
                    }}
                  >
                    Copy invitation link
                  </button>
                  <span role="status" aria-label="Invitation copy status">
                    {copyStatus}
                  </span>
                </div>
                <p>This link is shown once. It is not stored in your browser settings.</p>
              </div>
            )}
            <h2 className="invitation-list-heading">Invitations</h2>
            {data.invitations.length > 0 && (
              <ul className="member-list" aria-label="Invitations">
                {data.invitations.map((invitation) => (
                  <li key={invitation.id}>
                    <div>
                      <strong>{invitation.email}</strong>
                      <span>
                        {invitation.acceptedAt
                          ? "Accepted"
                          : invitation.revokedAt
                            ? "Revoked"
                            : invitation.expiresAt
                              ? `Expires ${new Date(invitation.expiresAt).toLocaleString()}`
                              : "Pending · no expiry"}
                      </span>
                    </div>
                    {!invitation.acceptedAt && !invitation.revokedAt && (
                      <button
                        className="button quiet compact"
                        disabled={Boolean(busy)}
                        aria-label={`Revoke invitation for ${invitation.email}`}
                        onClick={() =>
                          void perform(`revoke:${invitation.id}`, async () => {
                            await membershipRequest("/api/invitations/revoke", { id: invitation.id });
                          })
                        }
                      >
                        Revoke
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )
      )}
    </section>
  );
}
