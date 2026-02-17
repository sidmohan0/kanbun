import { ServiceStatus } from "./ServiceStatus.js";
import { ChatPanel } from "./ChatPanel.js";
import { useUiStore } from "../state/useUiStore.js";
import type { Section } from "../../src/shared/ui-store.js";

interface Props {
  activeSection: Section;
  onNavigate: (section: Section) => void;
  children: preact.ComponentChildren;
}

export function AppShell({ activeSection, onNavigate, children }: Props) {
  const { chatOpen, toggleChat } = useUiStore((s) => ({
    chatOpen: s.chatOpen,
    toggleChat: s.toggleChat,
  }));

  // Sidebar sections we want visible in the Workspace nav.
  // GTM remains reachable from the Dashboard card for now.
  const sections: Section[] = ["people", "projects", "drafts", "groups", "settings"];

  function labelFor(section: Section): string {
    switch (section) {
      case "people":
        return "People";
      case "projects":
        return "Projects";
      case "drafts":
        return "Drafts";
      case "groups":
        return "Groups";
      case "settings":
        return "Settings";
      default:
        return section;
    }
  }

  return (
    <div class="app">
      <div class="sidebar" style="display:flex;flex-direction:column;">
        <div style="flex:1;overflow-y:auto;">
          <div class="sidebar-brand" onClick={() => onNavigate("people")}>
            Kanbun
          </div>
          <hr style="margin: 8px 0 12px; border: none; border-top: 1px solid #e0e0e0;" />
          <h2>Workspace</h2>
          {sections.map((section) => (
            <div
              key={section}
              class={`sidebar-item ${activeSection === section ? "active" : ""}`}
              onClick={() => onNavigate(section)}
            >
              <span>{labelFor(section)}</span>
            </div>
          ))}
        </div>
        <ServiceStatus />
      </div>
      <div class="main">
        {children}
      </div>
      <button
        class={`chat-toggle ${chatOpen ? "chat-toggle-active" : ""}`}
        onClick={toggleChat}
        title="Toggle chat"
      >
        {chatOpen ? "\u00D7" : "\u{1F4AC}"}
      </button>
      <ChatPanel />
    </div>
  );
}
