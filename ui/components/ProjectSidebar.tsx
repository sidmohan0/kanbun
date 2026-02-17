import { ServiceStatus } from "./ServiceStatus.js";

interface Props {
  projects: any[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  pendingDrafts: number;
  onHome: () => void;
  onOpenDrafts: () => void;
  onOpenSettings?: () => void;
}

export function ProjectSidebar({ projects, selectedId, onSelect, pendingDrafts, onHome, onOpenDrafts, onOpenSettings }: Props) {
  return (
    <div class="sidebar" style="display:flex;flex-direction:column;">
      <div style="flex:1;overflow-y:auto;">
        <div class="sidebar-brand" onClick={onHome}>
          Kanbun
        </div>
        <hr style="margin: 8px 0 12px; border: none; border-top: 1px solid #e0e0e0;" />
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
        <div class="sidebar-item" onClick={onOpenDrafts} style="cursor:pointer">
          <span>Drafts</span>
          {pendingDrafts > 0 && <span class="badge">{pendingDrafts}</span>}
        </div>
        {onOpenSettings && (
          <div class="sidebar-item" onClick={onOpenSettings} style="cursor:pointer;margin-top:4px;">
            <span>Settings</span>
          </div>
        )}
      </div>
      <ServiceStatus />
    </div>
  );
}
