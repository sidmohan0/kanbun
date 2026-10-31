import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Mark } from "./brand/Mark";
import {
  AuthenticationError,
  authenticationRequest,
  desktopSignInLink,
  returnDestination,
  type SignInRoute,
} from "./authentication";
import { Turnstile } from "./Turnstile";
import { workspace } from "./workspace";
import "./styles/auth.css";

export function AuthenticationCard({ children }: { children: ReactNode }) {
  return (
    <main className="auth-shell">
      <div className="auth-card">
        <div className="brand-lockup">
          <Mark size={28} />
          <span>kanbun</span>
        </div>
        {children}
      </div>
    </main>
  );
}
export function EmailSignOut({ returnTo = "#issues", label = "Sign out" }: { returnTo?: string; label?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function signOut() {
    setBusy(true);
    setError(null);
    try {
      await workspace.flushPendingChanges();
      const result = await authenticationRequest("/api/auth/logout", {});
      if (result === null || typeof result !== "object" || !("ok" in result) || result.ok !== true)
        throw new Error("Sign-out could not be confirmed. Please try again.");
      workspace.requireAuthentication("You are signed out.");
      history.replaceState(null, "", returnDestination(returnTo));
      location.reload();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Sign-out could not be completed.");
      setBusy(false);
    }
  }
  return (
    <div className="auth-sign-out">
      <button className="button quiet compact" disabled={busy} onClick={() => void signOut()}>
        {busy ? "Signing out…" : label}
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
export function EmailSignIn({ siteKey, returnTo }: { siteKey: string; returnTo: string }) {
  const desktop = navigator.userAgent.includes("KanbunDesktop/");
  const [email, setEmail] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [verification, setVerification] = useState(0);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function request(event: FormEvent) {
    event.preventDefault();
    if (!turnstileToken || sending) return;
    setSending(true);
    setError(null);
    try {
      await authenticationRequest("/api/auth/request", { email: email.trim(), returnTo, turnstileToken });
      setSent(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The sign-in link could not be requested.");
    } finally {
      setSending(false);
      setTurnstileToken("");
      setVerification((value) => value + 1);
    }
  }
  return (
    <AuthenticationCard key={sent ? "sent" : "request"}>
      <p className="eyebrow">YOUR WORKSPACE</p>
      <h1>{sent ? "Check your email" : "Sign in to kanbun"}</h1>
      {sent ? (
        <>
          <p>
            If this email is eligible to access Kanbun, a sign-in link is on its way. Check your inbox and spam folder.
          </p>
          <p>
            {desktop
              ? "Open your email link. If it opens in a browser, choose Open in Kanbun. You can also copy the link and use File → Open sign-in link from clipboard here."
              : "Open the link in this same browser, then confirm your email to finish signing in. You can close this page while you check your email."}
          </p>
          <p>
            A sign-in link does not replace a workspace invitation. If you have not joined yet, use the invitation your
            workspace owner shared.
          </p>
          <button
            className="button"
            onClick={() => {
              setSent(false);
              setError(null);
            }}
          >
            Request another link
          </button>
        </>
      ) : (
        <>
          <p>
            Enter the email your workspace owner invited. We’ll email you a sign-in link. No password or Cloudflare
            account is needed.
          </p>
          {returnTo.startsWith("#invite/") && <p>Your invitation will reopen after you sign in.</p>}
          <form className="auth-form" onSubmit={(event) => void request(event)}>
            <label htmlFor="sign-in-email">Email address</label>
            <input
              id="sign-in-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={sending}
              autoFocus
            />
            <Turnstile key={verification} siteKey={siteKey} onToken={setTurnstileToken} />
            <button className="button primary" disabled={sending || !email.trim() || !turnstileToken}>
              {sending ? "Sending sign-in link…" : "Email me a sign-in link"}
            </button>
          </form>
          {error && (
            <p className="notice" role="alert">
              {error}
            </p>
          )}
          <p>Pending changes stay saved in this browser while you sign in again.</p>
        </>
      )}
    </AuthenticationCard>
  );
}

export function EmailSignInCallback({
  route,
  requestNew,
}: {
  route: Exclude<SignInRoute, null>;
  requestNew(returnTo: string): void;
}) {
  const [details, setDetails] = useState<{ email: string; expiresAt: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryable, setRetryable] = useState(false);
  const [wrongSession, setWrongSession] = useState(false);
  const invalid = "invalid" in route;
  const token = invalid ? null : route.token;
  const returnTo = invalid ? "#issues" : route.returnTo;
  useEffect(() => {
    let active = true;
    if (!token) return;
    void authenticationRequest("/api/auth/inspect", { token })
      .then((value) => {
        if (
          value === null ||
          typeof value !== "object" ||
          !("email" in value) ||
          typeof value.email !== "string" ||
          !("expiresAt" in value) ||
          typeof value.expiresAt !== "string" ||
          !Number.isFinite(Date.parse(value.expiresAt))
        )
          throw new Error("The server returned an invalid sign-in link.");
        if (active) setDetails({ email: value.email, expiresAt: value.expiresAt });
      })
      .catch((failure: unknown) => {
        if (!active) return;
        const unavailable = failure instanceof AuthenticationError && failure.status === 401;
        setWrongSession(unavailable);
        setRetryable(!unavailable);
        setError(
          unavailable
            ? "This sign-in link is unavailable. It may have expired, already been used, or been opened in a different browser or the desktop app. If you requested it in Kanbun, open it there. Otherwise request a new link in this browser."
            : failure instanceof Error
              ? failure.message
              : "The sign-in link could not be checked. Please try again.",
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token]);
  async function consume() {
    if (!token || !details || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await authenticationRequest("/api/auth/consume", { token });
      if (result === null || typeof result !== "object" || !("ok" in result) || result.ok !== true)
        throw new Error("Sign-in could not be confirmed.");
      // Only success removes the bearer. No token or email enters application storage.
      history.replaceState(null, "", returnTo);
      location.reload();
    } catch (failure) {
      const unavailable = failure instanceof AuthenticationError && failure.status === 401;
      setError(
        unavailable
          ? "This sign-in link is unavailable. Request a new link in this browser."
          : "Sign-in could not be confirmed. Reload to check your sign-in, or try confirming again.",
      );
      setRetryable(!unavailable);
      if (unavailable) setDetails(null);
      setBusy(false);
    }
  }
  return (
    <AuthenticationCard key={invalid ? "invalid" : loading ? "checking" : details ? "confirm" : "error"}>
      <p className="eyebrow">EMAIL SIGN-IN</p>
      <h1>Confirm your sign-in</h1>
      {invalid ? (
        <p role="alert">This sign-in link is invalid. Request a new link in this browser.</p>
      ) : loading ? (
        <p role="status">Checking your sign-in link…</p>
      ) : null}
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {details && (
        <>
          <p>
            You’re signing in as <strong>{details.email}</strong>.
          </p>
          <p>Link expires {new Date(details.expiresAt).toLocaleString()}.</p>
          <button className="button primary" disabled={busy} onClick={() => void consume()}>
            {busy ? "Signing in…" : `Sign in as ${details.email}`}
          </button>
        </>
      )}
      {wrongSession && token && !navigator.userAgent.includes("KanbunDesktop/") && (
        <p>
          <a className="button primary" href={desktopSignInLink(location.hash)!}>
            Open in Kanbun
          </a>
        </p>
      )}
      {retryable && (
        <button className="button" onClick={() => location.reload()}>
          Check link again
        </button>
      )}
      <p>Only continue if you requested this link in this browser.</p>
      <button className="button quiet" disabled={busy} onClick={() => requestNew(returnTo)}>
        Request a new link
      </button>
    </AuthenticationCard>
  );
}
