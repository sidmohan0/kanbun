import { useEffect, useState } from "react";
import { App } from "./App";
import { Button } from "./components/ui/button";
import { Invitation } from "./Invitation";
import { workspace } from "./workspace";
import { AuthenticationCard, EmailSignIn, EmailSignInCallback } from "./EmailSignIn";
import {
  AuthenticationError,
  authenticationConfig,
  authenticationRequest,
  rememberAuthentication,
  returnDestination,
  signInRequiredEvent,
  signInRoute,
  type AuthenticationConfig,
} from "./authentication";

function invitationToken(): string | null {
  if (!location.hash.startsWith("#invite/")) return null;
  try {
    return decodeURIComponent(location.hash.slice("#invite/".length));
  } catch {
    return "";
  }
}
/** Invitation entry must render before any workspace lease, cached rows, or mutation queue is opened. */
export function Entry() {
  const [token, setToken] = useState(invitationToken);
  const [hash, setHash] = useState(() => location.hash);
  const [config, setConfig] = useState<AuthenticationConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [localFallback, setLocalFallback] = useState(false);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  useEffect(() => {
    const route = () => {
      setToken(invitationToken());
      setHash(location.hash);
    };
    const expired = () => setNeedsSignIn(true);
    window.addEventListener("hashchange", route);
    window.addEventListener(signInRequiredEvent, expired);
    let active = true;
    void authenticationRequest("/api/auth/config")
      .then(authenticationConfig)
      .then((value) => {
        if (active) {
          rememberAuthentication(value.method);
          setConfig(value);
        }
      })
      .catch((failure: unknown) => {
        if (!active) return;
        // The existing context resolver is the sole authority for offline local descriptors.
        // Production and callback entry never open cached hosted work after a failed config fetch.
        if (
          failure instanceof AuthenticationError &&
          failure.status === 0 &&
          import.meta.env.DEV &&
          ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname) &&
          !location.hash.startsWith("#signin/")
        )
          setLocalFallback(true);
        else setConfigError(failure instanceof Error ? failure.message : "Sign-in could not be opened.");
      });
    return () => {
      active = false;
      window.removeEventListener("hashchange", route);
      window.removeEventListener(signInRequiredEvent, expired);
    };
  }, []);
  useEffect(() => {
    if (config?.method !== "email" || !config.authenticated || needsSignIn) return;
    let lastSent = 0;
    let sending = false;
    let active = true;
    const recordActivity = (event: Event) => {
      if (!event.isTrusted || sending || Date.now() - lastSent < 60_000) return;
      sending = true;
      void authenticationRequest("/api/auth/activity", {})
        .then(() => {
          lastSent = Date.now();
        })
        .catch((error: unknown) => {
          if (active && error instanceof AuthenticationError && error.status === 401) {
            workspace.requireAuthentication();
            setNeedsSignIn(true);
          }
        })
        .finally(() => {
          sending = false;
        });
    };
    for (const type of ["pointerdown", "keydown", "wheel"])
      window.addEventListener(type, recordActivity, { passive: true });
    return () => {
      active = false;
      for (const type of ["pointerdown", "keydown", "wheel"]) window.removeEventListener(type, recordActivity);
    };
  }, [config, needsSignIn]);
  if (configError)
    return (
      <AuthenticationCard>
        <h1>Couldn’t open sign-in</h1>
        <p role="alert">{configError}</p>
        <p>Check your connection and reload. Your pending changes remain saved in this browser.</p>
        <Button onClick={() => location.reload()}>Try again</Button>
      </AuthenticationCard>
    );
  if (!config && !localFallback)
    return (
      <AuthenticationCard>
        <h1>Opening kanbun…</h1>
        <p role="status">Checking sign-in…</p>
      </AuthenticationCard>
    );
  const callback = signInRoute(hash);
  if (callback)
    return (
      <EmailSignInCallback
        key={"token" in callback ? callback.token : hash}
        route={callback}
        requestNew={(returnTo) => {
          history.replaceState(null, "", returnTo);
          setHash(returnTo);
          setToken(invitationToken());
          setNeedsSignIn(true);
        }}
      />
    );
  if (config?.method === "email" && (!config.authenticated || needsSignIn))
    return <EmailSignIn siteKey={config.siteKey!} returnTo={returnDestination(hash)} />;
  return token === null ? <App /> : <Invitation key={token} token={token} nativeEmail={config?.method === "email"} />;
}
