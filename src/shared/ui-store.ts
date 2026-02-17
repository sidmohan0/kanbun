import { createStore } from "zustand/vanilla";

export type Section = "people" | "projects" | "drafts" | "gtm" | "groups" | "settings";

export type View =
  | "people"
  | "contact_profile"
  | "projects"
  | "project"
  | "drafts"
  | "gtm"
  | "groups"
  | "settings";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface UiState {
  view: View;
  section: Section;
  selectedProjectId: number | null;
  selectedContactId: number | null;
  peopleFilters: {
    q: string;
    tag: string;
    groupId: number | null;
  };
  gtmScenario: "conservative" | "base" | "aggressive";
  chatOpen: boolean;
  chatMessages: ChatMessage[];
  chatLoading: boolean;
}

export interface UiActions {
  navigateTo: (section: Section) => void;
  openProject: (projectId: number) => void;
  openContact: (contactId: number) => void;
  setPeopleFilters: (partial: Partial<UiState["peopleFilters"]>) => void;
  setGtmScenario: (scenario: UiState["gtmScenario"]) => void;
  toggleChat: () => void;
  addChatMessage: (msg: ChatMessage) => void;
  updateLastAssistantMessage: (text: string) => void;
  setChatLoading: (loading: boolean) => void;
  clearChat: () => void;
}

interface PersistedUiState {
  view: View;
  section: Section;
  selectedProjectId: number | null;
  selectedContactId: number | null;
  peopleFilters: UiState["peopleFilters"];
  gtmScenario: UiState["gtmScenario"];
}

const STORAGE_KEY = "kanbun_ui_state";

function loadInitialState(): UiState {
  if (typeof window === "undefined" || typeof localStorage === "undefined") {
    return getDefaultState();
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return getDefaultState();
    const persisted = JSON.parse(raw) as PersistedUiState;
    return {
      ...getDefaultState(),
      ...persisted,
      peopleFilters: {
        ...getDefaultState().peopleFilters,
        ...(persisted.peopleFilters ?? {}),
      },
    };
  } catch {
    return getDefaultState();
  }
}

function getDefaultState(): UiState {
  return {
    view: "people",
    section: "people",
    selectedProjectId: null,
    selectedContactId: null,
    peopleFilters: { q: "", tag: "", groupId: null },
    gtmScenario: "base",
    chatOpen: false,
    chatMessages: [],
    chatLoading: false,
  };
}

export const uiStore = createStore<UiState & UiActions>((set, get) => {
  const initial = loadInitialState();

  const store = {
    ...initial,

    navigateTo(section: Section) {
      const nextView: View =
        section === "people"
          ? "people"
          : section === "projects"
          ? "projects"
          : section === "drafts"
          ? "drafts"
          : section === "gtm"
          ? "gtm"
          : section === "groups"
          ? "groups"
          : "settings";
      set({ section, view: nextView });
    },

    openProject(projectId: number) {
      set({ section: "projects", view: "project", selectedProjectId: projectId });
    },

    openContact(contactId: number) {
      set({ section: "people", view: "contact_profile", selectedContactId: contactId });
    },

    setPeopleFilters(partial: Partial<UiState["peopleFilters"]>) {
      set({ peopleFilters: { ...get().peopleFilters, ...partial } });
    },

    setGtmScenario(scenario: UiState["gtmScenario"]) {
      set({ gtmScenario: scenario });
    },

    toggleChat() {
      set({ chatOpen: !get().chatOpen });
    },

    addChatMessage(msg: ChatMessage) {
      set({ chatMessages: [...get().chatMessages, msg] });
    },

    updateLastAssistantMessage(text: string) {
      const msgs = [...get().chatMessages];
      const last = msgs[msgs.length - 1];
      if (last && last.role === "assistant") {
        msgs[msgs.length - 1] = { ...last, content: last.content + text };
        set({ chatMessages: msgs });
      }
    },

    setChatLoading(loading: boolean) {
      set({ chatLoading: loading });
    },

    clearChat() {
      set({ chatMessages: [], chatLoading: false });
    },
  };

  return store;
});

// Persist to localStorage in browser environments
if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
  uiStore.subscribe((state) => {
    const snapshot: PersistedUiState = {
      view: state.view,
      section: state.section,
      selectedProjectId: state.selectedProjectId,
      selectedContactId: state.selectedContactId,
      peopleFilters: state.peopleFilters,
      gtmScenario: state.gtmScenario,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
      // ignore storage errors
    }
  });
}
