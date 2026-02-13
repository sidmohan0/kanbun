import { useState, useRef, useEffect } from "react";
import type { Message, MessageKind } from "@/types";

const kindDisplay: Partial<Record<MessageKind, { label: string; varColor: string }>> = {
  instruction: { label: "YOU", varColor: "--accent" },
  output: { label: "AGENT", varColor: "--dim" },
  error: { label: "ERROR", varColor: "--err" },
  blocked: { label: "BLOCKED", varColor: "--warn" },
  completed: { label: "STATUS", varColor: "--dim" },
  status_update: { label: "STATUS", varColor: "--dim" },
  heartbeat: { label: "HEARTBEAT", varColor: "--ghost" },
  pause: { label: "PAUSE", varColor: "--warn" },
  cancel: { label: "CANCEL", varColor: "--err" },
};

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function MessageBubble({ message }: { message: Message }) {
  const isOut = message.direction === "to_agent";
  const display = kindDisplay[message.kind] || { label: message.kind, varColor: "--dim" };

  if (message.kind === "heartbeat") return null;

  const isErr = message.kind === "error";
  const isBlk = message.kind === "blocked";
  let bubbleClass = isOut ? "msg-out" : "msg-in";
  if (isErr) bubbleClass = "msg-in msg-err";
  if (isBlk) bubbleClass = "msg-in msg-blocked";

  return (
    <div className={bubbleClass} style={{ padding: "7px 9px" }}>
      <div className="flex items-center justify-between" style={{ marginBottom: 3 }}>
        <span className="mn" style={{ fontSize: 8, fontWeight: 600, color: `var(${display.varColor})` }}>
          {display.label}
        </span>
        <span className="mn" style={{ fontSize: 8, color: "var(--ghost)" }}>
          {formatTime(message.created_at)}
        </span>
      </div>
      <div className="mn" style={{ fontSize: 10, lineHeight: 1.5, whiteSpace: "pre-wrap", color: "var(--main)" }}>
        {message.content}
      </div>
      {message.metadata && Object.keys(message.metadata).length > 0 && (
        <details style={{ marginTop: 4 }}>
          <summary className="mn" style={{ fontSize: 8, color: "var(--dim)", cursor: "pointer" }}>
            metadata
          </summary>
          <pre className="mn" style={{ fontSize: 8, color: "var(--dim)", marginTop: 2, overflowX: "auto" }}>
            {JSON.stringify(message.metadata, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

const quickActions: { label: string; kind: MessageKind; content: string }[] = [
  { label: "Status?", kind: "status_request", content: "" },
  { label: "Pause", kind: "pause", content: "" },
  { label: "Resume", kind: "resume", content: "" },
  { label: "Cancel", kind: "cancel", content: "" },
];

export function ConversationThread({
  agentId,
  messages,
  hasMore,
  loadingOlder,
  onLoadOlder,
  onSendMessage,
}: {
  agentId: string;
  messages: Message[];
  hasMore: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  onSendMessage: (kind: MessageKind, content: string) => void;
}) {
  const [input, setInput] = useState("");
  const [showHeartbeats, setShowHeartbeats] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastMessageIdRef = useRef<string | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [agentId]);

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    onSendMessage("instruction", trimmed);
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const filtered = showHeartbeats ? messages : messages.filter((m) => m.kind !== "heartbeat");
  const lastVisibleMessageId = filtered[filtered.length - 1]?.id ?? null;

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    // Auto-scroll only when the newest visible message changes.
    // This preserves scroll position when loading older pages at the top.
    if (lastVisibleMessageId !== lastMessageIdRef.current) {
      container.scrollTop = container.scrollHeight;
    }
    lastMessageIdRef.current = lastVisibleMessageId;
  }, [lastVisibleMessageId, filtered.length]);

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto min-h-0 flex flex-col gap-1.5"
        style={{ padding: "10px 12px" }}
      >
        {hasMore && (
          <div className="flex justify-center" style={{ paddingBottom: 8 }}>
            <button
              onClick={onLoadOlder}
              className="btn-cortex"
              style={{ fontSize: 9, padding: "4px 9px" }}
              disabled={loadingOlder}
            >
              {loadingOlder ? "Loading..." : "Load older messages"}
            </button>
          </div>
        )}
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="mn" style={{ fontSize: 10, color: "var(--dim)", textAlign: "center" }}>
              No messages yet.
              <br />
              Type below to send an instruction.
            </p>
          </div>
        ) : (
          filtered.map((msg) => <MessageBubble key={msg.id} message={msg} />)
        )}
      </div>

      {/* Quick actions + input */}
      <div style={{ padding: "8px 12px", borderTop: "1px solid var(--border)", background: "var(--bg-panel)" }}>
        <div className="flex gap-1" style={{ marginBottom: 6 }}>
          {quickActions.map((a) => (
            <button
              key={a.kind}
              onClick={() => onSendMessage(a.kind, a.content)}
              className="btn-cortex"
              style={{ fontSize: 8, padding: "3px 7px" }}
            >
              {a.label}
            </button>
          ))}
          <button
            onClick={() => setShowHeartbeats(!showHeartbeats)}
            className="btn-cortex"
            style={{
              fontSize: 8,
              padding: "3px 7px",
              marginLeft: "auto",
              color: showHeartbeats ? "var(--hi)" : undefined,
            }}
          >
            {showHeartbeats ? "Hide" : "Show"} HB
          </button>
        </div>
        <div className="flex gap-1.5 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Send instruction..."
            rows={1}
            className="mn"
            style={{
              flex: 1,
              resize: "none",
              background: "var(--bg-input)",
              border: "1px solid var(--border)",
              padding: "7px 9px",
              fontSize: 10,
              color: "var(--main)",
              outline: "none",
              minHeight: 30,
              maxHeight: 72,
            }}
            onInput={(e) => {
              const t = e.target as HTMLTextAreaElement;
              t.style.height = "30px";
              t.style.height = `${Math.min(t.scrollHeight, 72)}px`;
            }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim()}
            className="btn-cortex btn-fill"
            style={{ padding: "6px 10px" }}
          >
            Send
          </button>
        </div>
        <div className="mn" style={{ fontSize: 8, color: "var(--ghost)", marginTop: 3 }}>
          Enter to send · Shift+Enter for newline
        </div>
      </div>
    </div>
  );
}
