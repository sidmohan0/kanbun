import { useEffect, useState } from "preact/hooks";

interface Props {
  onShowPeople: () => void;
  onShowProjects: () => void;
  onShowDrafts: () => void;
  onShowSettings: () => void;
}

interface Group {
  id: number;
  name: string;
  color: string | null;
}

interface ContactRow {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
}

export function GroupsPage({ onShowPeople, onShowProjects, onShowDrafts, onShowSettings }: Props) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [members, setMembers] = useState<ContactRow[]>([]);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");

  useEffect(() => {
    loadGroups();
  }, []);

  useEffect(() => {
    if (selectedId != null) loadMembers(selectedId);
  }, [selectedId]);

  async function loadGroups() {
    const res = await fetch("/api/groups");
    if (!res.ok) return;
    const data = await res.json();
    setGroups(data);
    if (data.length > 0 && selectedId == null) {
      setSelectedId(data[0].id);
    }
  }

  async function loadMembers(groupId: number) {
    const res = await fetch(`/api/groups/${groupId}/contacts`);
    if (!res.ok) {
      setMembers([]);
      return;
    }
    const data = await res.json();
    setMembers(data);
  }

  async function handleCreateGroup() {
    if (!newName.trim()) return;
    setCreating(true);
    await fetch("/api/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim() }),
    });
    setNewName("");
    setCreating(false);
    await loadGroups();
  }

  async function handleRenameGroup(id: number) {
    if (!renameValue.trim()) {
      setRenamingId(null);
      return;
    }
    await fetch(`/api/groups/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: renameValue.trim() }),
    });
    setRenamingId(null);
    setRenameValue("");
    await loadGroups();
  }

  async function handleDeleteGroup(id: number) {
    if (!confirm("Delete this group?")) return;
    await fetch(`/api/groups/${id}`, { method: "DELETE" });
    if (selectedId === id) setSelectedId(null);
    await loadGroups();
  }

  return (
    <div class="groups-main">
      <div class="people-header">
        <div>
          <h1 class="people-title">Groups</h1>
          <p class="people-subtitle">Organize contacts into reusable cohorts.</p>
        </div>
      </div>

      <div class="groups-layout">
        <div class="groups-column">
          <h2 class="contact-section-title">Your Groups</h2>
          <div class="group-list">
            {groups.map((g) => (
              <div
                key={g.id}
                class={`sidebar-item ${g.id === selectedId ? "active" : ""}`}
                style="cursor:pointer;margin-bottom:4px;"
                onClick={() => setSelectedId(g.id)}
              >
                <span>{g.name}</span>
                <span>
                  <button
                    class="btn"
                    style="font-size:11px;padding:2px 6px;margin-right:4px;"
                    onClick={(e) => {
                      e.stopPropagation();
                      setRenamingId(g.id);
                      setRenameValue(g.name);
                    }}
                  >
                    Rename
                  </button>
                  <button
                    class="btn"
                    style="font-size:11px;padding:2px 6px;"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteGroup(g.id);
                    }}
                  >
                    Delete
                  </button>
                </span>
              </div>
            ))}
            {groups.length === 0 && <p style="font-size:12px;color:#999;">No groups yet.</p>}

            {renamingId != null && (
              <div style="margin-top:8px;">
                <input
                  type="text"
                  class="create-input"
                  placeholder="New name"
                  value={renameValue}
                  onInput={(e) => setRenameValue((e.target as HTMLInputElement).value)}
                />
                <button
                  class="btn btn-primary"
                  style="margin-top:4px;"
                  onClick={() => handleRenameGroup(renamingId)}
                >
                  Save
                </button>
              </div>
            )}

            <div style="margin-top:16px;">
              <h3 class="contact-section-title">Create Group</h3>
              <input
                type="text"
                class="create-input"
                placeholder="Group name"
                value={newName}
                onInput={(e) => setNewName((e.target as HTMLInputElement).value)}
              />
              <button
                class="btn btn-primary"
                style="margin-top:4px;"
                disabled={!newName.trim() || creating}
                onClick={handleCreateGroup}
              >
                {creating ? "Creating…" : "Create"}
              </button>
            </div>
          </div>
        </div>

        <div class="groups-column">
          <h2 class="contact-section-title">Members</h2>
          {selectedId == null && <p style="font-size:12px;color:#999;">Select a group to see its members.</p>}
          {selectedId != null && members.length === 0 && (
            <p style="font-size:12px;color:#999;">No contacts in this group yet.</p>
          )}
          <ul class="group-members">
            {members.map((m) => (
              <li key={m.id} class="group-member-row">
                <span>{m.first_name} {m.last_name}</span>
                <span style="color:#666;font-size:12px;margin-left:4px;">{m.email}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
