import { useState, useEffect, useRef } from "preact/hooks";
import { useUiStore } from "../state/useUiStore.js";

export function ChatPanel() {
  const {
    chatOpen,
    chatMessages,
    chatLoading,
    selectedProjectId,
    selectedContactId,
    toggleChat,
    addChatMessage,
    updateLastAssistantMessage,
    setChatLoading,
    clearChat,
  } = useUiStore((s) => ({
    chatOpen: s.chatOpen,
    chatMessages: s.chatMessages,
    chatLoading: s.chatLoading,
    selectedProjectId: s.selectedProjectId,
    selectedContactId: s.selectedContactId,
    toggleChat: s.toggleChat,
    addChatMessage: s.addChatMessage,
    updateLastAssistantMessage: s.updateLastAssistantMessage,
    setChatLoading: s.setChatLoading,
    clearChat: s.clearChat,
  }));

  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  if (!chatOpen) return null;

  async function handleSend() {
    const text = input.trim();
    if (!text || chatLoading) return;

    setInput("");
    addChatMessage({ role: "user", content: text });
    addChatMessage({ role: "assistant", content: "" });
    setChatLoading(true);

    try {
      const allMessages = [
        ...chatMessages.map((m) => ({ role: m.role, content: m.content })),
        { role: "user" as const, content: text },
      ];

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: allMessages,
          projectId: selectedProjectId,
          contactId: selectedContactId,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Request failed" }));
        updateLastAssistantMessage(err.error || "Something went wrong.");
        setChatLoading(false);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        updateLastAssistantMessage("No response stream available.");
        setChatLoading(false);
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const json = line.slice(6).trim();
          if (!json) continue;

          try {
            const event = JSON.parse(json);
            if (event.type === "delta" && event.text) {
              updateLastAssistantMessage(event.text);
            } else if (event.type === "error") {
              updateLastAssistantMessage(event.message || "An error occurred.");
            }
          } catch {
            // skip malformed events
          }
        }
      }
    } catch {
      updateLastAssistantMessage("Connection error. Please try again.");
    }

    setChatLoading(false);
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div class="chat-panel">
      <div class="chat-header">
        <span class="chat-header-title">Chat</span>
        <div class="chat-header-actions">
          <button class="btn" onClick={clearChat} title="Clear conversation">
            Clear
          </button>
          <button class="btn" onClick={toggleChat} title="Close chat">
            &times;
          </button>
        </div>
      </div>
      <div class="chat-messages">
        {chatMessages.length === 0 && (
          <div class="chat-empty">
            Ask me anything about your contacts, projects, or outreach strategy.
          </div>
        )}
        {chatMessages.map((msg, i) => (
          <div key={i} class={`chat-message chat-message-${msg.role}`}>
            {msg.content || (msg.role === "assistant" && chatLoading ? (
              <span class="chat-typing">
                <span /><span /><span />
              </span>
            ) : null)}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
      <div class="chat-input-area">
        <textarea
          class="chat-input"
          value={input}
          onInput={(e) => setInput((e.target as HTMLTextAreaElement).value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          rows={1}
          disabled={chatLoading}
        />
        <button
          class="btn btn-primary chat-send"
          onClick={handleSend}
          disabled={chatLoading || !input.trim()}
        >
          Send
        </button>
      </div>
    </div>
  );
}
