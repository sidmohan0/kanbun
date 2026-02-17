import { describe, it, expect, beforeEach } from "vitest";
import { uiStore, type Section } from "../ui-store.js";

function resetStore() {
  // naive reset: overwrite with default-like values
  uiStore.setState({
    view: "people",
    section: "people",
    selectedProjectId: null,
    selectedContactId: null,
    peopleFilters: { q: "", tag: "", groupId: null },
    gtmScenario: "base",
    chatOpen: false,
    chatMessages: [],
    chatLoading: false,
    navigateTo: uiStore.getState().navigateTo,
    openProject: uiStore.getState().openProject,
    openContact: uiStore.getState().openContact,
    setPeopleFilters: uiStore.getState().setPeopleFilters,
    setGtmScenario: uiStore.getState().setGtmScenario,
    toggleChat: uiStore.getState().toggleChat,
    addChatMessage: uiStore.getState().addChatMessage,
    updateLastAssistantMessage: uiStore.getState().updateLastAssistantMessage,
    setChatLoading: uiStore.getState().setChatLoading,
    clearChat: uiStore.getState().clearChat,
  });
}

describe("uiStore", () => {
  beforeEach(() => {
    resetStore();
  });

  it("navigates between sections and sets view accordingly", () => {
    const { navigateTo } = uiStore.getState();

    const sections: Section[] = ["people", "projects", "drafts", "gtm", "groups", "settings"];
    const expectedViews = ["people", "projects", "drafts", "gtm", "groups", "settings"] as const;

    sections.forEach((section, idx) => {
      navigateTo(section);
      const state = uiStore.getState();
      expect(state.section).toBe(section);
      expect(state.view).toBe(expectedViews[idx]);
    });
  });

  it("opens project and contact correctly", () => {
    const { openProject, openContact } = uiStore.getState();

    openProject(42);
    let state = uiStore.getState();
    expect(state.section).toBe("projects");
    expect(state.view).toBe("project");
    expect(state.selectedProjectId).toBe(42);

    openContact(7);
    state = uiStore.getState();
    expect(state.section).toBe("people");
    expect(state.view).toBe("contact_profile");
    expect(state.selectedContactId).toBe(7);
  });

  it("merges people filters and sets GTM scenario", () => {
    const { setPeopleFilters, setGtmScenario } = uiStore.getState();

    setPeopleFilters({ q: "alice" });
    let state = uiStore.getState();
    expect(state.peopleFilters.q).toBe("alice");
    expect(state.peopleFilters.tag).toBe("");

    setPeopleFilters({ tag: "founder", groupId: 1 });
    state = uiStore.getState();
    expect(state.peopleFilters.q).toBe("alice");
    expect(state.peopleFilters.tag).toBe("founder");
    expect(state.peopleFilters.groupId).toBe(1);

    setGtmScenario("aggressive");
    state = uiStore.getState();
    expect(state.gtmScenario).toBe("aggressive");
  });

  it("toggles chat panel open and closed", () => {
    expect(uiStore.getState().chatOpen).toBe(false);
    uiStore.getState().toggleChat();
    expect(uiStore.getState().chatOpen).toBe(true);
    uiStore.getState().toggleChat();
    expect(uiStore.getState().chatOpen).toBe(false);
  });

  it("adds chat messages and updates last assistant message", () => {
    const { addChatMessage, updateLastAssistantMessage } = uiStore.getState();

    addChatMessage({ role: "user", content: "hello" });
    expect(uiStore.getState().chatMessages).toHaveLength(1);
    expect(uiStore.getState().chatMessages[0]).toEqual({ role: "user", content: "hello" });

    addChatMessage({ role: "assistant", content: "" });
    expect(uiStore.getState().chatMessages).toHaveLength(2);

    updateLastAssistantMessage("Hi");
    updateLastAssistantMessage(" there");
    expect(uiStore.getState().chatMessages[1].content).toBe("Hi there");
  });

  it("clears chat messages and resets loading", () => {
    const { addChatMessage, setChatLoading, clearChat } = uiStore.getState();

    addChatMessage({ role: "user", content: "test" });
    addChatMessage({ role: "assistant", content: "response" });
    setChatLoading(true);

    expect(uiStore.getState().chatMessages).toHaveLength(2);
    expect(uiStore.getState().chatLoading).toBe(true);

    clearChat();
    expect(uiStore.getState().chatMessages).toHaveLength(0);
    expect(uiStore.getState().chatLoading).toBe(false);
  });

  it("does not update message if last message is not assistant", () => {
    const { addChatMessage, updateLastAssistantMessage } = uiStore.getState();

    addChatMessage({ role: "user", content: "hello" });
    updateLastAssistantMessage("should not append");
    expect(uiStore.getState().chatMessages[0].content).toBe("hello");
  });
});
