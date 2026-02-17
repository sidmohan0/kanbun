import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
} from "@mariozechner/pi-coding-agent";
import kanbunPiExtension from "./kanbunPiExtension.js";

type Role = "user" | "assistant";

export interface ChatMessageInput {
  role: Role;
  content: string;
}

interface AgentStreamEvent {
  type: "delta" | "done" | "error";
  text: string;
}

function formatContextPrompt(
  messages: ChatMessageInput[],
  projectId: number | null,
  contactId: number | null,
): string {
  const contextLines: string[] = [];

  if (projectId != null) {
    contextLines.push(`Current context: selected project id ${projectId}.`);
  }
  if (contactId != null) {
    contextLines.push(`Current context: selected contact id ${contactId}.`);
  }
  contextLines.push("Use the tools available to this CRM system to execute user requests, then explain the result.");

  const history = messages
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n");

  if (!history.trim()) {
    return contextLines.join("\n") + "\n\n" +
      "Please answer the user's request using your available Kanbun tools when applicable.";
  }

  return [
    ...contextLines,
    "",
    "Conversation so far:",
    history,
    "",
    "Use this conversation and available tools to continue from here.",
  ].join("\n");
}

let sessionPromise: Promise<Awaited<ReturnType<typeof createAgentSession>>["session"]> | null =
  null;

async function getPiSession(): Promise<Awaited<ReturnType<typeof createAgentSession>>["session"]> {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const authStorage = new AuthStorage();
      const modelRegistry = new ModelRegistry(authStorage);
      const resourceLoader = new DefaultResourceLoader({
        cwd: process.cwd(),
        extensionFactories: [kanbunPiExtension],
      });
      await resourceLoader.reload();

      const { session } = await createAgentSession({
        sessionManager: SessionManager.inMemory(),
        authStorage,
        modelRegistry,
        resourceLoader,
      });

      return session;
    })();
  }

  return sessionPromise;
}

export async function runKanbunAgent(
  messages: ChatMessageInput[],
  projectId: number | null,
  contactId: number | null,
  emit: (event: AgentStreamEvent) => Promise<void> | void,
): Promise<void> {
  const session = await getPiSession();

  const prompt = formatContextPrompt(messages, projectId, contactId);

  const unsub = session.subscribe((event: any) => {
    if (!event) return;

    if (event.type === "message_update") {
      const assistantEvent = event.assistantMessageEvent;
      if (!assistantEvent) return;

      if (assistantEvent.type === "text_delta" && typeof assistantEvent.delta === "string") {
        void emit({ type: "delta", text: assistantEvent.delta });
      }

      if (assistantEvent.type === "thinking_delta" && typeof assistantEvent.delta === "string") {
        void emit({ type: "delta", text: assistantEvent.delta });
      }
      return;
    }

    if (event.type === "tool_execution_start" && event.toolName) {
      void emit({
        type: "delta",
        text: `\n\n[Running tool: ${event.toolName}]\n`,
      });
      return;
    }

    if (event.type === "tool_execution_end") {
      const toolName = event.toolName;
      if (toolName && event.isError) {
        void emit({ type: "delta", text: `\n[Tool ${toolName} failed]\n` });
      } else if (toolName) {
        void emit({ type: "delta", text: `\n[Tool ${toolName} completed]\n` });
      }
      return;
    }

    if (event.type === "error") {
      const message =
        typeof event.error === "string" ? event.error : event.error?.message ?? "Unexpected agent error";
      void emit({ type: "error", text: message });
    }
  });

  try {
    // Clear prior messages so each request is fully scoped to user-provided history.
    const agentState: any = (session as any).agent;
    if (agentState?.replaceMessages) {
      agentState.replaceMessages([]);
    }

    await session.prompt(prompt);
    await emit({ type: "done", text: "" });
  } catch (error: any) {
    const msg =
      error?.message ??
      "Kanbun agent failed to answer. Verify ANTHROPIC_API_KEY and that pi dependencies are installed.";
    await emit({ type: "error", text: msg });
  } finally {
    unsub();
  }
}
