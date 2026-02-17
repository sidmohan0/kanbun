import { useEffect, useState } from "preact/hooks";

interface Props {
  contactId: number;
  onBackToPeople: () => void;
  onShowProjects: () => void;
  onShowDrafts: () => void;
  onShowGroups: () => void;
  onShowSettings: () => void;
}

interface Group {
  id: number;
  name: string;
}

interface ContactProfile {
  contact: any;
  tags: string[];
  groups: Group[];
  notes: { id: number; body: string; created_at: string; created_by: string | null }[];
  social_links: { provider: string; value: string }[];
}

export function ContactProfilePage({
  contactId,
  onBackToPeople,
  onShowProjects,
  onShowDrafts,
  onShowGroups,
  onShowSettings,
}: Props) {
  const [profile, setProfile] = useState<ContactProfile | null>(null);
  const [allGroups, setAllGroups] = useState<Group[]>([]);
  const [tagsInput, setTagsInput] = useState("");
  const [noteBody, setNoteBody] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadProfile();
    loadGroups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactId]);

  async function loadProfile() {
    const res = await fetch(`/api/contacts/${contactId}/profile`);
    if (!res.ok) return;
    const data = await res.json();
    setProfile(data);
    setTagsInput(data.tags.join(", "));
  }

  async function loadGroups() {
    const res = await fetch("/api/groups");
    if (!res.ok) return;
    const data = await res.json();
    setAllGroups(data);
  }

  async function handleSaveContact() {
    if (!profile) return;
    setSaving(true);
    try {
      const c = profile.contact;
      await fetch(`/api/contacts/${contactId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          first_name: c.first_name,
          last_name: c.last_name,
          email: c.email,
          company: c.company,
          title: c.title,
          phone: c.phone,
          website: c.website,
          linkedin_url: c.linkedin_url,
          notes: c.notes,
        }),
      });
      await loadProfile();
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveTags() {
    if (!profile) return;
    const tags = tagsInput
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    await fetch(`/api/contacts/${contactId}/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tags }),
    });
    await loadProfile();
  }

  async function handleAddNote() {
    if (!noteBody.trim()) return;
    await fetch(`/api/contacts/${contactId}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: noteBody }),
    });
    setNoteBody("");
    await loadProfile();
  }

  async function handleToggleGroup(groupId: number, checked: boolean) {
    if (checked) {
      await fetch(`/api/groups/${groupId}/contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contact_id: contactId }),
      });
    } else {
      await fetch(`/api/groups/${groupId}/contacts/${contactId}`, {
        method: "DELETE" },
      );
    }
    await loadProfile();
  }

  if (!profile) {
    return <p>Loading contact…</p>;
  }

  const c = profile.contact;
  const groupIds = new Set(profile.groups.map((g) => g.id));

  return (
    <div class="contact-profile">
      <button class="btn" onClick={onBackToPeople} style="margin-bottom:16px;">
        ← Back to People
      </button>

      <h1 class="people-title">
        {c.first_name} {c.last_name}
      </h1>
      <p class="contact-subtitle">
        {c.title && <span>{c.title} · </span>}
        {c.company && <span>{c.company} · </span>}
        <span>{c.email}</span>
      </p>

      <div class="contact-grid">
        <div class="contact-section">
          <h2 class="contact-section-title">Profile</h2>
          <div class="contact-field">
            <label class="field-label">Company</label>
            <input
              type="text"
              class="create-input"
              value={c.company ?? ""}
              onInput={(e) => {
                const v = (e.target as HTMLInputElement).value;
                setProfile({ ...profile, contact: { ...c, company: v } });
              }}
            />
          </div>
          <div class="contact-field">
            <label class="field-label">Title</label>
            <input
              type="text"
              class="create-input"
              value={c.title ?? ""}
              onInput={(e) => {
                const v = (e.target as HTMLInputElement).value;
                setProfile({ ...profile, contact: { ...c, title: v } });
              }}
            />
          </div>
          <div class="contact-field">
            <label class="field-label">Phone</label>
            <input
              type="text"
              class="create-input"
              value={c.phone ?? ""}
              onInput={(e) => {
                const v = (e.target as HTMLInputElement).value;
                setProfile({ ...profile, contact: { ...c, phone: v } });
              }}
            />
          </div>
          <div class="contact-field">
            <label class="field-label">Website</label>
            <input
              type="text"
              class="create-input"
              value={c.website ?? ""}
              onInput={(e) => {
                const v = (e.target as HTMLInputElement).value;
                setProfile({ ...profile, contact: { ...c, website: v } });
              }}
            />
          </div>
          <div class="contact-field">
            <label class="field-label">LinkedIn</label>
            <input
              type="text"
              class="create-input"
              value={c.linkedin_url ?? ""}
              onInput={(e) => {
                const v = (e.target as HTMLInputElement).value;
                setProfile({ ...profile, contact: { ...c, linkedin_url: v } });
              }}
            />
          </div>
          <div class="contact-field">
            <label class="field-label">Notes</label>
            <textarea
              class="draft-body"
              rows={4}
              value={c.notes ?? ""}
              onInput={(e) => {
                const v = (e.target as HTMLTextAreaElement).value;
                setProfile({ ...profile, contact: { ...c, notes: v } });
              }}
            />
          </div>
          <button class="btn btn-primary" disabled={saving} onClick={handleSaveContact}>
            {saving ? "Saving…" : "Save Profile"}
          </button>
        </div>

        <div class="contact-section">
          <h2 class="contact-section-title">Tags</h2>
          <input
            type="text"
            class="create-input"
            placeholder="Comma-separated tags"
            value={tagsInput}
            onInput={(e) => setTagsInput((e.target as HTMLInputElement).value)}
          />
          <button class="btn" style="margin-top:8px;" onClick={handleSaveTags}>
            Update Tags
          </button>
          <div class="tag-list">
            {profile.tags.map((t) => (
              <span key={t} class="tag-pill">
                {t}
              </span>
            ))}
            {profile.tags.length === 0 && (
              <p style="font-size:12px;color:#999;margin-top:8px;">No tags yet.</p>
            )}
          </div>

          <h2 class="contact-section-title" style="margin-top:24px;">Groups</h2>
          <div class="group-list">
            {allGroups.map((g) => (
              <label key={g.id} class="group-row">
                <input
                  type="checkbox"
                  checked={groupIds.has(g.id)}
                  onChange={(e) =>
                    handleToggleGroup(g.id, (e.target as HTMLInputElement).checked)
                  }
                />
                <span>{g.name}</span>
              </label>
            ))}
            {allGroups.length === 0 && (
              <p style="font-size:12px;color:#999;">No groups created yet.</p>
            )}
          </div>

          <h2 class="contact-section-title" style="margin-top:24px;">Social</h2>
          <ul class="social-list">
            {profile.social_links.map((s, idx) => (
              <li key={idx}>
                <strong>{s.provider}:</strong>{" "}
                <a href={s.value} target="_blank" rel="noreferrer">
                  {s.value}
                </a>
              </li>
            ))}
            {profile.social_links.length === 0 && (
              <p style="font-size:12px;color:#999;">No social links stored.</p>
            )}
          </ul>
        </div>

        <div class="contact-section">
          <h2 class="contact-section-title">Notes Timeline</h2>
          <div class="note-composer">
            <textarea
              class="draft-body"
              rows={3}
              placeholder="Add a note about this contact…"
              value={noteBody}
              onInput={(e) => setNoteBody((e.target as HTMLTextAreaElement).value)}
            />
            <button class="btn btn-primary" style="margin-top:8px;" onClick={handleAddNote}>
              Add Note
            </button>
          </div>
          <div class="notes-list">
            {profile.notes.map((n) => (
              <div key={n.id} class="note-item">
                <div class="note-meta">
                  <span>{new Date(n.created_at).toLocaleString()}</span>
                  {n.created_by && <span> · {n.created_by}</span>}
                </div>
                <div class="note-body">{n.body}</div>
              </div>
            ))}
            {profile.notes.length === 0 && (
              <p style="font-size:12px;color:#999;">No notes yet.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
