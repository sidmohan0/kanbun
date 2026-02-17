import { useState, useEffect } from "preact/hooks";
import { ProjectSidebar } from "../components/ProjectSidebar.js";
import { PipelineBar } from "../components/PipelineBar.js";

interface Props {
  selectedProject: number | null;
  onSelectProject: (id: number) => void;
  onOpenDrafts: () => void;
  onHome: () => void;
  onOpenGtm: (projectName: string) => void;
  onOpenSettings: () => void;
}

export function Dashboard({ selectedProject, onSelectProject, onOpenDrafts, onHome, onOpenGtm, onOpenSettings }: Props) {
  const [projects, setProjects] = useState<any[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [pendingDrafts, setPendingDrafts] = useState(0);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    fetch("/api/projects").then(r => r.json()).then(setProjects);
    fetch("/api/drafts?status=pending_review").then(r => r.json()).then(d => setPendingDrafts(d.length));
    fetch("/api/accounts").then(r => r.json()).then(setAccounts);
  }, []);

  useEffect(() => {
    if (selectedProject) {
      fetch(`/api/contacts?project_id=${selectedProject}`).then(r => r.json()).then(setContacts);
      fetch(`/api/templates?project_id=${selectedProject}`).then(r => r.json()).then(setTemplates);
    }
  }, [selectedProject]);

  const project = projects.find(p => p.id === selectedProject);
  const stageCounts: Record<string, number> = {};
  if (project) {
    for (const stage of project.pipeline_stages) {
      stageCounts[stage] = contacts.filter(c => c.current_stage === stage).length;
    }
  }

  async function handleGenerate(mode: "agent" | "template", templateId?: number) {
    if (!selectedProject) return;
    setGenerating(true);
    try {
      const body: any = { project_id: selectedProject, mode };
      if (mode === "template" && templateId) body.template_id = templateId;
      const res = await fetch("/api/drafts/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.count > 0) {
        setPendingDrafts(prev => prev + data.count);
      }
    } finally {
      setGenerating(false);
    }
  }

  function handleAddAccount(provider: "gmail" | "outlook") {
    // Prefer using Settings for troubleshooting, but keep direct connect for convenience
    window.open(`/api/accounts/oauth/${provider}/start`, "_blank");
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
        onOpenSettings={onOpenSettings}
      />
      <div class="main">
        <div class="top-bar">
          <h1>{project ? project.name : "Kanbun"}</h1>
          <div class="accounts">
            {accounts.map(a => (
              <span class="account-badge" key={a.id}>{a.email_address}</span>
            ))}
            <button class="btn" onClick={() => handleAddAccount("gmail")} style="font-size:12px;padding:4px 8px">
              + Gmail
            </button>
            <button class="btn" onClick={() => handleAddAccount("outlook")} style="font-size:12px;padding:4px 8px">
              + Outlook
            </button>
            <button
              class="btn"
              onClick={onOpenSettings}
              style="font-size:12px;padding:4px 8px;"
            >
              Settings
            </button>
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

            {/* Draft Generation */}
            <div style="margin-top:16px;display:flex;gap:8px;align-items:center">
              <span style="font-size:13px;color:#666">Generate drafts:</span>
              <button
                class="btn btn-primary"
                disabled={generating || !project.default_send_account_id}
                onClick={() => handleGenerate("agent")}
                style="font-size:13px"
              >
                {generating ? "Generating..." : "AI Agent"}
              </button>
              {templates.length > 0 && templates.map(t => (
                <button
                  key={t.id}
                  class="btn btn-secondary"
                  disabled={generating || !project.default_send_account_id}
                  onClick={() => handleGenerate("template", t.id)}
                  style="font-size:13px"
                >
                  {t.name}
                </button>
              ))}
              {!project.default_send_account_id && (
                <span style="font-size:12px;color:#c62828">Set a default send account first</span>
              )}
            </div>
          </>
        ) : (
          <p>Select a project from the sidebar to get started.</p>
        )}
      </div>
    </div>
  );
}
