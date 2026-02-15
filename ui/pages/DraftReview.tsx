import { useState, useEffect } from "preact/hooks";
import { ContactCard } from "../components/ContactCard.js";

interface Props {
  onBack: () => void;
}

export function DraftReview({ onBack }: Props) {
  const [drafts, setDrafts] = useState<any[]>([]);
  const [index, setIndex] = useState(0);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [contact, setContact] = useState<any>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    fetch("/api/drafts?status=pending_review")
      .then(r => r.json())
      .then(d => {
        setDrafts(d);
        if (d.length > 0) {
          setSubject(d[0].subject);
          setBody(d[0].body);
        }
      });
  }, []);

  useEffect(() => {
    const current = drafts[index];
    if (current) {
      setSubject(current.subject);
      setBody(current.body);
      fetch(`/api/drafts/${current.id}`)
        .then(r => r.json())
        .then(d => {
          // The GET /api/drafts/:id endpoint joins contact info
          setContact({
            first_name: d.first_name,
            last_name: d.last_name,
            email: d.email,
            company: d.company,
            title: d.title,
          });
        });
    }
  }, [index, drafts]);

  const current = drafts[index];

  async function handleAction(action: "skip" | "save" | "send") {
    if (!current) return;
    setSending(true);

    if (action === "skip") {
      await fetch(`/api/drafts/${current.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "skipped" }),
      });
    } else if (action === "save") {
      await fetch(`/api/drafts/${current.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, body }),
      });
    } else if (action === "send") {
      // Save content first
      await fetch(`/api/drafts/${current.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, body }),
      });
      // Then send
      await fetch(`/api/drafts/${current.id}/send`, { method: "POST" });
    }

    setSending(false);

    // Remove current draft and advance
    const remaining = drafts.filter((_, i) => i !== index);
    setDrafts(remaining);
    setIndex(Math.min(index, remaining.length - 1));
  }

  if (drafts.length === 0) {
    return (
      <div class="app">
        <div class="main" style="display:flex;flex-direction:column;align-items:center;justify-content:center;">
          <p style="margin-bottom:16px;">No drafts to review.</p>
          <button onClick={onBack} class="btn">← Back to Dashboard</button>
        </div>
      </div>
    );
  }

  return (
    <div class="app">
      <div class="main">
        <div class="draft-header">
          <button onClick={onBack} class="btn">← Back</button>
          <span class="draft-nav">Draft {index + 1} of {drafts.length}</span>
          <div class="draft-nav-buttons">
            <button onClick={() => setIndex(Math.max(0, index - 1))} disabled={index === 0} class="btn">Prev</button>
            <button onClick={() => setIndex(Math.min(drafts.length - 1, index + 1))} disabled={index === drafts.length - 1} class="btn">Next</button>
          </div>
        </div>

        {contact && <ContactCard contact={contact} />}

        <div class="draft-editor">
          <label class="field-label">Subject</label>
          <input
            type="text"
            value={subject}
            onInput={(e) => setSubject((e.target as HTMLInputElement).value)}
            class="draft-subject"
          />

          <label class="field-label">Body</label>
          <textarea
            value={body}
            onInput={(e) => setBody((e.target as HTMLTextAreaElement).value)}
            class="draft-body"
            rows={14}
          />
        </div>

        <div class="draft-actions">
          <button onClick={() => handleAction("skip")} disabled={sending} class="btn btn-secondary">Skip</button>
          <button onClick={() => handleAction("save")} disabled={sending} class="btn btn-secondary">Save & Next</button>
          <button onClick={() => handleAction("send")} disabled={sending} class="btn btn-primary">Send</button>
        </div>
      </div>
    </div>
  );
}
