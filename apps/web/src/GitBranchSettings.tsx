import { useState, type FormEvent } from "react";
import { branchName, DEFAULT_GIT_BRANCH_FORMAT, gitBranchFormatSchema } from "@kanbun/mutators";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { workspace, type WorkspaceSnapshot } from "./workspace";
import "./styles/github.css";

function BranchFormatForm({ current }: { current: string }) {
  const [format, setFormat] = useState(current);
  const [error, setError] = useState<string | null>(null);
  const parsed = gitBranchFormatSchema.safeParse(format);
  const preview = parsed.success ? branchName(format, "member", "KAN-123", "Improve search") : "";
  function save(event: FormEvent) {
    event.preventDefault();
    if (!parsed.success) {
      setError(parsed.error.issues[0]!.message);
      return;
    }
    try {
      workspace.setGitBranchFormat(format);
      setError(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The branch format could not be saved.");
    }
  }
  return (
    <form className="github-bind-form" onSubmit={save}>
      <label htmlFor="git-branch-format">Git branch format</label>
      <Input
        id="git-branch-format"
        value={format}
        required
        onChange={(event) => setFormat(event.target.value)}
        aria-describedby="git-branch-format-help git-branch-format-preview"
      />
      <p id="git-branch-format-help">
        Include {"{issueIdentifier}"}. You can also use {"{username}"} and {"{issueTitle}"}, separated by letters,
        numbers, hyphens, underscores or slashes. Usernames and titles become lowercase slugs.
      </p>
      <p id="git-branch-format-preview">
        Preview: <code>{preview || "Enter a valid git branch format"}</code>
      </p>
      {error && <p role="alert">{error}</p>}
      <Button variant="outline" disabled={format === current}>
        Save branch format
      </Button>
    </form>
  );
}

export function GitBranchSettings({ snapshot }: { snapshot: WorkspaceSnapshot }) {
  const member = snapshot.members.find((candidate) => candidate.id === snapshot.context?.actor.id);
  if (!snapshot.organization || (member?.role !== "owner" && member?.role !== "admin")) return null;
  const current = snapshot.organization.gitBranchFormat || DEFAULT_GIT_BRANCH_FORMAT;
  return (
    <section className="github-settings" aria-label="Git branch names">
      <h2>Git branch names</h2>
      <p>Choose the branch name members copy from an issue. This works with any git hosting provider.</p>
      <BranchFormatForm key={current} current={current} />
    </section>
  );
}
