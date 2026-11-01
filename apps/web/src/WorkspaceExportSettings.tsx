import { useState } from "react";
import { Button } from "./components/ui/button";
import { requireEmailSignIn } from "./authentication";
import type { WorkspaceSnapshot } from "./workspace";

export function WorkspaceExportSettings({ snapshot }: { snapshot: WorkspaceSnapshot }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (snapshot.context?.role !== "owner") return null;
  async function download(type: "issues" | "projects") {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/exports.csv?type=${type}`, {
        credentials: "include",
        cache: "no-store",
        redirect: "manual",
      });
      if (response.status === 401) requireEmailSignIn();
      if (!response.ok || !response.headers.get("content-type")?.startsWith("text/csv"))
        throw new Error("The CSV could not be exported. Check your connection and owner access, then try again.");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `kanbun-${type}.csv`;
      document.body.append(link);
      link.click();
      link.remove();
      // Keep the URL alive through the download navigation, then release its memory.
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The CSV could not be exported. Try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="github-settings" aria-label="CSV exports">
      <h2>CSV exports</h2>
      <p>
        Download public-team issues or projects as a snapshot. Private-team issues and private-only projects are
        excluded. No Google connection is needed.
      </p>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      <div className="github-connection-actions">
        <Button variant="outline" disabled={busy} onClick={() => void download("issues")}>
          Download issues CSV
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => void download("projects")}>
          Download projects CSV
        </Button>
      </div>
    </section>
  );
}
