import { useState, useEffect } from "preact/hooks";

interface Props {
  onSelectProject: (id: number) => void;
  onOpenDrafts: () => void;
}

export function Home({ onSelectProject, onOpenDrafts }: Props) {
  const [projects, setProjects] = useState<any[]>([]);
  const [contactCounts, setContactCounts] = useState<Record<number, number>>({});
  const [draftCounts, setDraftCounts] = useState<Record<number, number>>({});
  const [pendingTotal, setPendingTotal] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [creating, setCreating] = useState(false);

  async function loadProjects() {
    const ps = await fetch("/api/projects").then(r => r.json());
    setProjects(ps);

    // Fetch contact counts per project
    const counts: Record<number, number> = {};
    const drafts: Record<number, number> = {};
    await Promise.all(ps.map(async (p: any) => {
      const contacts = await fetch(`/api/contacts?project_id=${p.id}`).then(r => r.json());
      counts[p.id] = contacts.length;
      const projectDrafts = await fetch(`/api/drafts?project_id=${p.id}&status=pending_review`).then(r => r.json());
      drafts[p.id] = projectDrafts.length;
    }));
    setContactCounts(counts);
    setDraftCounts(drafts);

    const allPending = await fetch("/api/drafts?status=pending_review").then(r => r.json());
    setPendingTotal(allPending.length);
  }

  useEffect(() => { loadProjects(); }, []);

  async function handleCreate() {
    if (!newName.trim()) return;
    setCreating(true);
    await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim(), description: newDesc.trim() || undefined }),
    });
    setNewName("");
    setNewDesc("");
    setShowCreate(false);
    setCreating(false);
    await loadProjects();
  }

  return (
    <div class="home">
      <div class="home-header">
        <div>
          <h1 class="home-title">Kanbun</h1>
          <p class="home-subtitle">{projects.length} project{projects.length !== 1 ? "s" : ""} active</p>
        </div>
        <div style="display:flex;gap:8px;">
          {pendingTotal > 0 && (
            <button class="btn" onClick={onOpenDrafts}>
              {pendingTotal} draft{pendingTotal !== 1 ? "s" : ""} to review
            </button>
          )}
          <button class="btn btn-primary" onClick={() => setShowCreate(true)}>
            + New Project
          </button>
        </div>
      </div>

      {showCreate && (
        <div class="create-form">
          <input
            type="text"
            placeholder="Project name"
            value={newName}
            onInput={(e) => setNewName((e.target as HTMLInputElement).value)}
            class="create-input"
            autofocus
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          />
          <input
            type="text"
            placeholder="Description (optional)"
            value={newDesc}
            onInput={(e) => setNewDesc((e.target as HTMLInputElement).value)}
            class="create-input"
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          />
          <div class="create-actions">
            <button class="btn btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
            <button class="btn btn-primary" onClick={handleCreate} disabled={creating || !newName.trim()}>Create</button>
          </div>
        </div>
      )}

      <div class="project-grid">
        {projects.map(p => (
          <div key={p.id} class="project-card" onClick={() => onSelectProject(p.id)}>
            <div class="project-card-name">{p.name}</div>
            {p.description && <div class="project-card-desc">{p.description}</div>}
            <div class="project-card-stages">
              {p.pipeline_stages.map((s: string) => (
                <span class="stage-tag" key={s}>{s}</span>
              ))}
              {p.pipeline_stages.length === 0 && <span class="stage-tag empty">No stages set</span>}
            </div>
            <div class="project-card-stats">
              <span>{contactCounts[p.id] ?? 0} contacts</span>
              {(draftCounts[p.id] ?? 0) > 0 && (
                <span class="draft-count">{draftCounts[p.id]} pending</span>
              )}
              {p.follow_up_cadence.length > 0 && (
                <span>Follow-up: d{p.follow_up_cadence.join(", d")}</span>
              )}
            </div>
          </div>
        ))}

        {projects.length === 0 && !showCreate && (
          <div class="empty-state">
            <p>No projects yet. Create one to get started.</p>
            <button class="btn btn-primary" onClick={() => setShowCreate(true)}>+ New Project</button>
          </div>
        )}
      </div>
    </div>
  );
}
