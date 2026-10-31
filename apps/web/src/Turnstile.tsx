import { useEffect, useRef, useState } from "react";

type TurnstileApi = {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      action: "magic_link";
      theme: "auto";
      size: "flexible";
      callback(token: string): void;
      "expired-callback"(): void;
      "error-callback"(): void;
    },
  ): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
};
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}
let scriptTask: Promise<TurnstileApi> | null = null;
function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (scriptTask) return scriptTask;
  const script = document.createElement("script");
  script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
  script.async = true;
  script.defer = true;
  scriptTask = new Promise<TurnstileApi>((resolve, reject) => {
    script.onload = () =>
      window.turnstile ? resolve(window.turnstile) : reject(new Error("Verification could not load."));
    script.onerror = () => reject(new Error("Verification could not load. Check your connection and try again."));
    document.head.append(script);
  }).catch((failure: unknown) => {
    script.remove();
    scriptTask = null;
    throw failure;
  });
  return scriptTask;
}

/** Explicit rendering supports SPA mounts without proxying or caching Cloudflare's managed widget. */
export function Turnstile({ siteKey, onToken }: { siteKey: string; onToken(token: string): void }) {
  const container = useRef<HTMLDivElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    let api: TurnstileApi | undefined;
    let widgetId: string | undefined;
    void loadTurnstile()
      .then((loaded) => {
        if (!active || !container.current) return;
        api = loaded;
        widgetId = api.render(container.current, {
          sitekey: siteKey,
          action: "magic_link",
          theme: "auto",
          size: "flexible",
          callback(token) {
            if (active) {
              setError(null);
              onToken(token);
            }
          },
          "expired-callback"() {
            if (!active) return;
            onToken("");
            if (widgetId !== undefined) api?.reset(widgetId);
          },
          "error-callback"() {
            if (active) {
              onToken("");
              setError("Verification could not finish. Try again.");
            }
          },
        });
      })
      .catch((failure: unknown) => {
        if (active) setError(failure instanceof Error ? failure.message : "Verification could not load.");
      });
    return () => {
      active = false;
      if (widgetId !== undefined) api?.remove(widgetId);
    };
  }, [siteKey, onToken, attempt]);
  return (
    <div className="auth-verification">
      <div ref={container} />
      {error && (
        <>
          <p role="alert">{error}</p>
          <button
            className="button quiet compact"
            type="button"
            onClick={() => {
              onToken("");
              setError(null);
              setAttempt((value) => value + 1);
            }}
          >
            Retry verification
          </button>
        </>
      )}
    </div>
  );
}
