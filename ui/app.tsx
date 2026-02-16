import { render } from "preact";
import { useState } from "preact/hooks";
import { Home } from "./pages/Home.js";
import { Dashboard } from "./pages/Dashboard.js";
import { DraftReview } from "./pages/DraftReview.js";

type View = "home" | "project" | "drafts";

function App() {
  const [view, setView] = useState<View>("home");
  const [selectedProject, setSelectedProject] = useState<number | null>(null);

  function goToProject(id: number) {
    setSelectedProject(id);
    setView("project");
  }

  if (view === "drafts") {
    return <DraftReview onBack={() => setView(selectedProject ? "project" : "home")} />;
  }

  if (view === "project" && selectedProject) {
    return (
      <Dashboard
        selectedProject={selectedProject}
        onSelectProject={goToProject}
        onOpenDrafts={() => setView("drafts")}
        onHome={() => setView("home")}
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
