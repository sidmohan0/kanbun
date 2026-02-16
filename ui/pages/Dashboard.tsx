import { useState, useEffect } from "preact/hooks";
import { ProjectSidebar } from "../components/ProjectSidebar.js";
import { PipelineBar } from "../components/PipelineBar.js";

interface Props {
  selectedProject: number | null;
  onSelectProject: (id: number) => void;
  onOpenDrafts: () => void;
  onHome: () => void;
  onOpenGtm: (projectName: string) => void;
}

export function Dashboard({ selectedProject, onSelectProject, onOpenDrafts, onHome, onOpenGtm }: Props) {
  const [projects, setProjects] = useState<any[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [pendingDrafts, setPendingDrafts] = useState(0);
  const [accounts, setAccounts] = useState<any[]>([]);

  useEffect(() => {
    fetch("/api/projects").then(r => r.json()).then(setProjects);
    fetch("/api/drafts?status=pending_review").then(r => r.json()).then(d => setPendingDrafts(d.length));
    fetch("/api/accounts").then(r => r.json()).then(setAccounts);
  }, []);

  useEffect(() => {
    if (selectedProject) {
      fetch(`/api/contacts?project_id=${selectedProject}`).then(r => r.json()).then(setContacts);
    }
  }, [selectedProject]);

  const project = projects.find(p => p.id === selectedProject);
  const stageCounts: Record<string, number> = {};
  if (project) {
    for (const stage of project.pipeline_stages) {
      stageCounts[stage] = contacts.filter(c => c.current_stage === stage).length;
    }
  }

  return (
    <div class="app">
      <ProjectSidebar
        projects={projects}
        selectedId={selectedProject}
        onSelect={onSelectProject}
        pendingDrafts={pendingDrafts}
        onHome={onHome}
        onOpenDrafts={onOpenDrafts}
      />
      <div class="main">
        <div class="top-bar">
          <h1>{project ? project.name : "Kanbun"}</h1>
          <div class="accounts">
            {accounts.map(a => (
              <span class="account-badge" key={a.id}>{a.provider}</span>
            ))}
          </div>
        </div>
        {project ? (
          <>
            <PipelineBar stages={project.pipeline_stages} counts={stageCounts} />
            <div class="info-cards">
              <div class="info-card" onClick={onOpenDrafts} style="cursor:pointer">
                <h3>Drafts Pending Review</h3>
                <div class="value">{pendingDrafts}</div>
              </div>
              <div class="info-card">
                <h3>Total Contacts</h3>
                <div class="value">{contacts.length}</div>
              </div>
              <div class="info-card" onClick={() => onOpenGtm(project!.name)} style="cursor:pointer">
                <h3>Growth Model</h3>
                <div class="value" style="font-size:14px">View Projections →</div>
              </div>
            </div>
          </>
        ) : (
          <p>Select a project from the sidebar to get started.</p>
        )}
      </div>
    </div>
  );
}
