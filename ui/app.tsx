import { render } from "preact";
import { useState } from "preact/hooks";
import { Dashboard } from "./pages/Dashboard.js";
import { DraftReview } from "./pages/DraftReview.js";

function App() {
  const [view, setView] = useState<"dashboard" | "drafts">("dashboard");
  const [selectedProject, setSelectedProject] = useState<number | null>(null);

  if (view === "drafts") {
    return <DraftReview onBack={() => setView("dashboard")} />;
  }

  return (
    <Dashboard
      selectedProject={selectedProject}
      onSelectProject={setSelectedProject}
      onOpenDrafts={() => setView("drafts")}
    />
  );
}

render(<App />, document.getElementById("app")!);
