import { useEffect, useState } from "preact/hooks";
import { ContactCard } from "../components/ContactCard.js";
import { useUiStore } from "../state/useUiStore.js";

interface Props {
  onOpenProfile: (id: number) => void;
  onShowGroups: () => void;
  onShowProjects: () => void;
  onShowDrafts: () => void;
  onShowSettings: () => void;
}

interface Group {
  id: number;
  name: string;
}

interface ContactRow {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  company: string | null;
  title: string | null;
}

interface CsvSummary {
  inserted: number;
  updated: number;
  skipped: number;
  errors: string[];
}

interface ParsedCsv {
  headers: string[];
  rows: Array<Record<string, string>>;
}

function parseCsv(text: string): ParsedCsv {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    throw new Error("CSV file is empty");
  }

  const headers = lines[0].split(",").map((h) => h.trim());
  if (!headers.includes("email")) {
    throw new Error("CSV must include an 'email' column");
  }

  const rows: Array<Record<string, string>> = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    if (cols.length === 1 && !cols[0].trim()) continue;
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = (cols[idx] ?? "").trim();
    });
    rows.push(row);
  }

  return { headers, rows };
}

export function PeoplePage({
  onOpenProfile,
  onShowGroups,
  onShowProjects,
  onShowDrafts,
  onShowSettings,
}: Props) {
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [groups, setGroups] = useState<Group[]>([]);

  const { peopleFilters, setPeopleFilters } = useUiStore((state) => ({
    peopleFilters: state.peopleFilters,
    setPeopleFilters: state.setPeopleFilters,
  }));

  const { q, tag, groupId } = peopleFilters;

  const [importFileName, setImportFileName] = useState("");
  const [previewRows, setPreviewRows] = useState<Array<Record<string, string>>>([]);
  const [parsedRows, setParsedRows] = useState<Array<Record<string, string>>>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [summary, setSummary] = useState<CsvSummary | null>(null);
  const [dedupeMode, setDedupeMode] = useState<"skip" | "update">("skip");

  useEffect(() => {
    loadGroups();
  }, []);

  useEffect(() => {
    loadContacts();
  }, [q, tag, groupId]);

  async function loadGroups() {
    try {
      const res = await fetch("/api/groups");
      if (!res.ok) return;
      const data = await res.json();
      setGroups(data);
    } catch {
      // ignore
    }
  }

  async function loadContacts() {
    setLoading(true);
    try {
      const params: string[] = [];
      if (q.trim()) params.push("q=" + encodeURIComponent(q.trim()));
      if (tag.trim()) params.push("tag=" + encodeURIComponent(tag.trim()));
      if (groupId) params.push("group_id=" + groupId);
      const qs = params.length ? `?${params.join("&")}` : "";
      const res = await fetch(`/api/contacts${qs}`);
      if (!res.ok) {
        setContacts([]);
        return;
      }
      const data = await res.json();
      setContacts(data);
    } catch {
      setContacts([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleFileChange(e: Event) {
    const input = e.target as HTMLInputElement | null;
    if (!input || !input.files || input.files.length === 0) return;

    const file = input.files[0];
    setImportFileName(file.name);
    setParseError(null);
    setSummary(null);
    setPreviewRows([]);
    setParsedRows([]);

    try {
      const text = await file.text();
      const parsed = parseCsv(text);
      setParsedRows(parsed.rows);
      setPreviewRows(parsed.rows.slice(0, 10));
    } catch (err: any) {
      setParseError(err?.message || "Failed to parse CSV");
    }
  }

  async function handleImport() {
    if (parsedRows.length === 0) return;
    setImporting(true);
    setParseError(null);
    setSummary(null);
    try {
      const res = await fetch("/api/contacts/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: parsedRows,
          dedupe_mode: dedupeMode,
          legacy_response: false,
        }),
      });
      if (!res.ok) {
        setParseError("Import failed");
        return;
      }
      const data = await res.json();
      setSummary(data.summary as CsvSummary);
      await loadContacts();
    } catch {
      setParseError("Import failed");
    } finally {
      setImporting(false);
    }
  }

  return (
    <>
      <div class="people-header">
        <div>
          <h1 class="people-title">People</h1>
          <p class="people-subtitle">Search and filter contacts across all projects.</p>
          {(q.trim() || tag.trim() || (groupId !== null && groupId !== "")) && (
            <p style="font-size:12px;color:#777;margin-top:4px;">
              Filters active
              {q.trim() && <> · search: "{q.trim()}"</>}
              {tag.trim() && <> · tag: "{tag.trim()}"</>}
              {groupId !== null && groupId !== "" && <> · group selected</>}
            </p>
          )}
        </div>
      </div>

      <div class="people-filters" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
        <input
          type="text"
          class="people-search"
          placeholder="Search by name, email, or company..."
          value={q}
          onInput={(e) => setPeopleFilters({ q: (e.target as HTMLInputElement).value })}
        />
        <input
          type="text"
          class="people-tag-filter"
          placeholder="Tag filter"
          value={tag}
          onInput={(e) => setPeopleFilters({ tag: (e.target as HTMLInputElement).value })}
        />
        <select
          class="people-group-filter"
          value={groupId === "" || groupId === null ? "" : String(groupId)}
          onChange={(e) => {
            const val = (e.target as HTMLSelectElement).value;
            setPeopleFilters({ groupId: val ? Number(val) : null });
          }}
        >
          <option value="">All groups</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        <button
          class="btn"
          type="button"
          onClick={() => setPeopleFilters({ q: "", tag: "", groupId: null })}
          style="font-size:12px;padding:4px 8px;"
        >
          Reset filters
        </button>
      </div>

      <div style="margin-top:16px;margin-bottom:16px;background:#fff;border:1px solid #e0e0e0;border-radius:8px;padding:12px 16px;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:8px;flex-wrap:wrap;">
          <div>
            <div class="contact-section-title">Import from CSV</div>
            <p style="font-size:12px;color:#666;">
              Upload a CSV with at least an <code>email</code> column. Optional columns: first_name, last_name,
              company, title, phone, linkedin_url, notes.
            </p>
          </div>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <input type="file" accept=".csv,text/csv" onChange={handleFileChange} />
            <select
              value={dedupeMode}
              onChange={(e) => setDedupeMode((e.target as HTMLSelectElement).value as "skip" | "update")}
              class="people-group-filter"
            >
              <option value="skip">Skip existing emails</option>
              <option value="update">Update existing emails</option>
            </select>
            <button
              class="btn btn-primary"
              disabled={importing || parsedRows.length === 0}
              onClick={handleImport}
            >
              {importing ? "Importing…" : "Import"}
            </button>
          </div>
        </div>
        {importFileName && (
          <p style="font-size:12px;color:#666;margin-bottom:4px;">Selected file: {importFileName}</p>
        )}
        {parseError && (
          <p style="font-size:12px;color:#c62828;margin-bottom:4px;">{parseError}</p>
        )}
        {summary && (
          <p style="font-size:12px;color:#2e7d32;margin-bottom:4px;">
            Inserted {summary.inserted}, updated {summary.updated}, skipped {summary.skipped}. {summary.errors.length > 0 &&
              `Errors: ${summary.errors.length}`}
          </p>
        )}
        {previewRows.length > 0 && (
          <div style="margin-top:8px;max-height:160px;overflow:auto;">
            <table style="width:100%;border-collapse:collapse;font-size:12px;">
              <thead>
                <tr>
                  {Object.keys(previewRows[0]).map((h) => (
                    <th
                      key={h}
                      style="text-align:left;border-bottom:1px solid #eee;padding:4px 6px;color:#888;"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row, idx) => (
                  <tr key={idx}>
                    {Object.keys(previewRows[0]).map((h) => (
                      <td key={h} style="border-bottom:1px solid #f5f5f5;padding:4px 6px;">
                        {row[h]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {loading && <p style="margin-top:16px;">Loading people…</p>}

      {!loading && contacts.length === 0 && (
        <p style="margin-top:16px;color:#666;">No contacts match your filters yet.</p>
      )}

      <div class="people-list">
        {contacts.map((c) => (
          <button
            key={c.id}
            class="people-row"
            onClick={() => onOpenProfile(c.id)}
          >
            <ContactCard contact={c} />
          </button>
        ))}
      </div>
    </>
  );
}
