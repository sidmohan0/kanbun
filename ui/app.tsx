import { render } from "preact";
import { useState } from "preact/hooks";
import { Home } from "./pages/Home.js";
import { Dashboard } from "./pages/Dashboard.js";
import { DraftReview } from "./pages/DraftReview.js";
import { GtmDashboard } from "./pages/GtmDashboard.js";
import { PeoplePage } from "./pages/PeoplePage.js";
import { ContactProfilePage } from "./pages/ContactProfilePage.js";
import { GroupsPage } from "./pages/GroupsPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";
import { AppShell } from "./components/AppShell.js";
import { useUiStore } from "./state/useUiStore.js";

function App() {
  const { view, section, selectedProjectId, selectedContactId, navigateTo, openProject, openContact } = useUiStore(
    (state) => ({
      view: state.view,
      section: state.section,
      selectedProjectId: state.selectedProjectId,
      selectedContactId: state.selectedContactId,
      navigateTo: state.navigateTo,
      openProject: state.openProject,
      openContact: state.openContact,
    }),
  );
  const [selectedProjectName, setSelectedProjectName] = useState("");

  let content: preact.VNode;

  if (view === "drafts") {
    content = (
      <DraftReview
        onBack={() => {
          if (selectedProjectId != null) {
            // Return to project context if we have one
            openProject(selectedProjectId);
          } else {
            navigateTo("projects");
          }
        }}
      />
    );
  } else if (view === "gtm") {
    if (selectedProjectId == null) {
      content = <Home onSelectProject={openProject} onOpenDrafts={() => navigateTo("drafts")} />;
    } else {
      content = (
        <GtmDashboard
          projectId={selectedProjectId}
          projectName={selectedProjectName}
          onBack={() => openProject(selectedProjectId)}
        />
      );
    }
  } else if (view === "project") {
    if (selectedProjectId == null) {
      content = <Home onSelectProject={openProject} onOpenDrafts={() => navigateTo("drafts")} />;
    } else {
      content = (
        <Dashboard
          selectedProject={selectedProjectId}
          onSelectProject={openProject}
          onOpenDrafts={() => navigateTo("drafts")}
          onHome={() => navigateTo("projects")}
          onOpenGtm={(name: string) => {
            setSelectedProjectName(name);
            navigateTo("gtm");
          }}
          onOpenSettings={() => navigateTo("settings")}
        />
      );
    }
  } else if (view === "projects") {
    content = <Home onSelectProject={openProject} onOpenDrafts={() => navigateTo("drafts")} />;
  } else if (view === "contact_profile") {
    if (selectedContactId == null) {
      content = (
        <PeoplePage
          onOpenProfile={openContact}
          onShowGroups={() => navigateTo("groups")}
          onShowProjects={() => navigateTo("projects")}
          onShowDrafts={() => navigateTo("drafts")}
          onShowSettings={() => navigateTo("settings")}
        />
      );
    } else {
      content = (
        <ContactProfilePage
          contactId={selectedContactId}
          onBackToPeople={() => navigateTo("people")}
          onShowProjects={() => navigateTo("projects")}
          onShowDrafts={() => navigateTo("drafts")}
          onShowGroups={() => navigateTo("groups")}
          onShowSettings={() => navigateTo("settings")}
        />
      );
    }
  } else if (view === "groups") {
    content = (
      <GroupsPage
        onShowPeople={() => navigateTo("people")}
        onShowProjects={() => navigateTo("projects")}
        onShowDrafts={() => navigateTo("drafts")}
        onShowSettings={() => navigateTo("settings")}
      />
    );
  } else if (view === "settings") {
    content = (
      <SettingsPage
        onBackToPeople={() => navigateTo("people")}
        onShowProjects={() => navigateTo("projects")}
        onShowDrafts={() => navigateTo("drafts")}
        onShowGroups={() => navigateTo("groups")}
      />
    );
  } else {
    // Default: People view
    content = (
      <PeoplePage
        onOpenProfile={openContact}
        onShowGroups={() => navigateTo("groups")}
        onShowProjects={() => navigateTo("projects")}
        onShowDrafts={() => navigateTo("drafts")}
        onShowSettings={() => navigateTo("settings")}
      />
    );
  }

  return (
    <AppShell
      activeSection={section}
      onNavigate={(section) => navigateTo(section)}
    >
      {content}
    </AppShell>
  );
}

render(<App />, document.getElementById("app")!);
