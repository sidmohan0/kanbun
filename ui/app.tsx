import { render } from "preact";
import { useState } from "preact/hooks";
import { Dashboard } from "./pages/Dashboard.js";

function App() {
  const [view, setView] = useState<"dashboard" | "drafts">("dashboard");
  const [selectedProject, setSelectedProject] = useState<number | null>(null);

  return (
    <Dashboard
      selectedProject={selectedProject}
      onSelectProject={setSelectedProject}
      onOpenDrafts={() => setView("drafts")}
    />
  );
}

render(<App />, document.getElementById("app")!);
