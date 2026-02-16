import { render } from "preact";
import { useState } from "preact/hooks";
import { Home } from "./pages/Home.js";
import { Dashboard } from "./pages/Dashboard.js";
import { DraftReview } from "./pages/DraftReview.js";
import { GtmDashboard } from "./pages/GtmDashboard.js";

type View = "home" | "project" | "drafts" | "gtm";

function App() {
  const [view, setView] = useState<View>("home");
  const [selectedProject, setSelectedProject] = useState<number | null>(null);
  const [selectedProjectName, setSelectedProjectName] = useState("");

  function goToProject(id: number) {
    setSelectedProject(id);
    setView("project");
  }

  if (view === "drafts") {
    return <DraftReview onBack={() => setView(selectedProject ? "project" : "home")} />;
  }

  if (view === "gtm" && selectedProject) {
    return (
      <GtmDashboard
        projectId={selectedProject}
        projectName={selectedProjectName}
        onBack={() => setView("project")}
      />
    );
  }

  if (view === "project" && selectedProject) {
    return (
      <Dashboard
        selectedProject={selectedProject}
        onSelectProject={goToProject}
        onOpenDrafts={() => setView("drafts")}
        onHome={() => setView("home")}
        onOpenGtm={(name: string) => {
          setSelectedProjectName(name);
          setView("gtm");
        }}
      />
    );
  }

  return (
    <Home
      onSelectProject={goToProject}
      onOpenDrafts={() => setView("drafts")}
    />
  );
}

render(<App />, document.getElementById("app")!);
