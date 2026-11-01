import { useEffect, useRef, useState } from "react";
import { Button } from "./components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "./components/ui/dialog";
import { membershipRequest } from "./membership";
import type { WorkspaceSnapshot } from "./workspace";

type Status = { configured: boolean; connected: boolean; failed: boolean };
function status(value: unknown): Status {
  if (
    !value ||
    typeof value !== "object" ||
    !("configured" in value) ||
    !("connected" in value) ||
    typeof value.configured !== "boolean" ||
    typeof value.connected !== "boolean"
  )
    throw new Error("Invalid status");
  return { configured: value.configured, connected: value.connected, failed: "error" in value && value.error !== null };
}
function SyncAction({ onSettings }: { onSettings: () => void }) {
  const [connection, setConnection] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void membershipRequest("/api/integrations/google-sheets")
      .then(status)
      .then((value) => {
        if (active) setConnection(value);
      })
      .catch(() => {
        if (active) setError("Google Sheets status could not be loaded. Reopen Commands to try again.");
      });
    return () => {
      active = false;
    };
  }, []);
  async function sync() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const value = await membershipRequest("/api/integrations/google-sheets/sync", {});
      const result = status(value);
      setConnection(result);
      if (
        !result.configured ||
        !result.connected ||
        result.failed ||
        !value ||
        typeof value !== "object" ||
        !("lastSyncedAt" in value) ||
        typeof value.lastSyncedAt !== "string" ||
        !Number.isFinite(Date.parse(value.lastSyncedAt))
      )
        throw new Error("Sync failed");
      setMessage("Google Sheets synced successfully.");
    } catch {
      setError("Google Sheets could not be synced. Check the connection in Settings and try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {!connection && !error && <p role="status">Loading Google Sheets status…</p>}
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {connection && (!connection.configured || !connection.connected) && (
        <p>
          {connection.configured
            ? "Connect Google Sheets in Settings before syncing."
            : "Google Sheets is not configured for this installation."}
        </p>
      )}
      <Button disabled={!connection?.configured || !connection.connected || busy} onClick={() => void sync()}>
        {busy ? "Syncing to Google Sheets…" : "Sync to Google Sheets"}
      </Button>
      <a href="#settings/integrations" onClick={onSettings}>
        Google Sheets settings
      </a>
    </>
  );
}
export function GoogleSheetsCommand({ snapshot }: { snapshot: WorkspaceSnapshot }) {
  const owner = snapshot.context?.mode === "hosted" && snapshot.context.role === "owner";
  const [open, setOpen] = useState(false);
  const previousFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!owner) return;
    function keydown(event: KeyboardEvent) {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        event.altKey ||
        !(event.metaKey || event.ctrlKey) ||
        event.key.toLowerCase() !== "k"
      )
        return;
      const target = event.target;
      if (
        document.querySelector('[role="dialog"], [role="alertdialog"]') ||
        (target instanceof Element &&
          target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]'))
      )
        return;
      event.preventDefault();
      previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setOpen(true);
    }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [owner]);
  if (!owner) return null;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          onClick={() => {
            previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          }}
        >
          Commands <kbd>⌘/Ctrl K</kbd>
        </Button>
      </DialogTrigger>
      <DialogContent
        onCloseAutoFocus={(event) => {
          if (previousFocus.current?.isConnected) {
            event.preventDefault();
            previousFocus.current.focus();
          }
        }}
      >
        <DialogTitle>Commands</DialogTitle>
        <DialogDescription>Run workspace actions.</DialogDescription>
        {open && <SyncAction onSettings={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>
  );
}
