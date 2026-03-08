type SettingsFeedbackProps = {
  connected?: string;
  disconnected?: string;
  error?: string | null;
  synced?: string;
};

export function SettingsFeedback({
  connected,
  disconnected,
  error,
  synced,
}: SettingsFeedbackProps) {
  return (
    <>
      {error ? (
        <div className="rounded-2xl border border-destructive/20 bg-destructive/8 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}
      {connected ? (
        <div className="rounded-2xl border border-border/80 bg-primary/8 px-4 py-3 text-sm text-foreground">
          {connected === "google"
            ? "Google account connected and queued for initial sync."
            : connected === "microsoft"
              ? "Microsoft account connected and queued for initial sync."
              : "Todoist connected and queued for initial reconciliation."}
        </div>
      ) : null}
      {synced ? (
        <div className="rounded-2xl border border-border/80 bg-primary/8 px-4 py-3 text-sm text-foreground">
          {synced === "google"
            ? "Google sync queued for the worker."
            : synced === "microsoft"
              ? "Microsoft sync queued for the worker."
              : "Todoist reconciliation queued for the worker."}
        </div>
      ) : null}
      {disconnected ? (
        <div className="rounded-2xl border border-border/80 bg-secondary/80 px-4 py-3 text-sm text-foreground">
          {disconnected === "google"
            ? "Google account disconnected."
            : disconnected === "microsoft"
              ? "Microsoft account disconnected."
              : "Todoist account disconnected."}
        </div>
      ) : null}
    </>
  );
}
