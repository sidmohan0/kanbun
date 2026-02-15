interface Props {
  projects: any[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  pendingDrafts: number;
}

export function ProjectSidebar({ projects, selectedId, onSelect, pendingDrafts }: Props) {
  return (
    <div class="sidebar">
      <h2>Projects</h2>
      {projects.map(p => (
        <div
          key={p.id}
          class={`sidebar-item ${p.id === selectedId ? "active" : ""}`}
          onClick={() => onSelect(p.id)}
        >
          <span>{p.name}</span>
        </div>
      ))}
      <hr style="margin: 16px 0; border: none; border-top: 1px solid #e0e0e0;" />
      <div class="sidebar-item" style="cursor:default">
        <span>Drafts</span>
        {pendingDrafts > 0 && <span class="badge">{pendingDrafts}</span>}
      </div>
    </div>
  );
}
