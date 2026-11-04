import { useState } from "react";
import { Button } from "./components/ui/button";
import { NativeSelect } from "./components/ui/native-select";
import {
  importFields,
  MAX_IMPORT_BYTES,
  parseCsv,
  previewCsvImport,
  proposeColumnMapping,
  type ImportField,
  type ImportPreviewRow,
  type ParsedCsv,
} from "./csv-issue-import";
import { workspace, type WorkspaceSnapshot } from "./workspace";

const fieldLabels: Record<ImportField, string> = {
  sourceIdentifier: "Source ID (duplicate check)",
  title: "Title",
  description: "Description",
  state: "Status",
  priority: "Priority",
  estimate: "Estimate",
  dueDate: "Due date",
  assignee: "Assignee",
  labels: "Labels",
};
const fieldOrder: ImportField[] = [
  "title",
  "description",
  "state",
  "priority",
  "estimate",
  "dueDate",
  "assignee",
  "labels",
  "sourceIdentifier",
];
const message = (failure: unknown) => (failure instanceof Error ? failure.message : "The CSV could not be read.");

function rowErrors(row: ImportPreviewRow): string {
  return row.errors.length
    ? row.errors.join(" ")
    : row.duplicate
      ? "This source ID already exists in the selected team."
      : "Ready to import";
}

export function WorkspaceIssueImport({ snapshot }: { snapshot: WorkspaceSnapshot }) {
  const teams = snapshot.teams.filter((team) => !team.archivedAt && !team.retiredAt);
  const [teamId, setTeamId] = useState(teams[0]?.id ?? "");
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [mapping, setMapping] = useState<Record<ImportField, number | null> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const team = teams.find((candidate) => candidate.id === teamId) ?? teams[0];
  const authorized =
    !team || team.visibility !== "private"
      ? null
      : new Set(
          snapshot.teamMemberships
            .filter((membership) => membership.teamId === team.id && !membership.archivedAt)
            .map((membership) => membership.userId),
        );
  const members = snapshot.members.filter((member) => !authorized || authorized.has(member.id));
  let preview: ImportPreviewRow[] = [];
  if (parsed && mapping && team) {
    try {
      preview = previewCsvImport(
        parsed,
        mapping,
        team,
        snapshot.workflowStates,
        members,
        snapshot.issueIdentifiers,
        snapshot.labels,
      );
    } catch {
      preview = [];
    }
  }
  const ready = preview.filter((row) => !row.duplicate && row.errors.length === 0);
  const duplicates = preview.filter((row) => row.duplicate).length;
  const invalid = preview.filter((row) => !row.duplicate && row.errors.length > 0);
  const unmappedColumns =
    parsed && mapping
      ? parsed.headers.filter((_, index) => !importFields.some((field) => mapping[field] === index))
      : [];

  if (snapshot.context?.role !== "owner") return null;

  async function readFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setImportResult(null);
    setParsed(null);
    setMapping(null);
    setFileName(file.name);
    try {
      if (!file.name.toLocaleLowerCase().endsWith(".csv") && file.type !== "text/csv")
        throw new Error("Choose a CSV file.");
      if (file.size > MAX_IMPORT_BYTES) throw new Error("The CSV exceeds the 2 MB file-size limit.");
      const result = parseCsv(await file.text());
      setParsed(result);
      setMapping(proposeColumnMapping(result.headers));
    } catch (failure) {
      setError(message(failure));
    }
  }

  function updateMapping(field: ImportField, value: string) {
    const column = value === "" ? null : Number(value);
    setMapping((current) => {
      if (!current) return current;
      const next = { ...current, [field]: column };
      if (column !== null) {
        for (const other of importFields) if (other !== field && next[other] === column) next[other] = null;
      }
      return next;
    });
    setImportResult(null);
  }

  function importReadyRows() {
    if (!team || ready.length === 0) return;
    setError(null);
    setImportResult(null);
    setBusy(true);
    try {
      const ids = workspace.importIssues(
        team.id,
        ready.map((row) => row.record!),
      );
      if (!ids.length) {
        setBusy(false);
        return;
      }
      void workspace.waitForIssueImports(ids).then(({ rejected, accepted }) => {
        if (rejected.length)
          setImportResult(`${accepted} imported; ${rejected.length} rejected. ${rejected[0]!.message}`);
        else setImportResult(`${accepted} ${accepted === 1 ? "issue" : "issues"} imported successfully.`);
        setBusy(false);
      });
    } catch (failure) {
      setBusy(false);
      setError(message(failure));
    }
  }

  return (
    <section className="github-settings" aria-label="Import issues from CSV">
      <h2>Import issues from CSV</h2>
      <p>
        Choose a CSV and review the proposed columns before importing. The file is read in this browser and is not
        uploaded; only the issue fields you map are sent through Kanbun’s normal issue creation and team access checks.
        Up to 1,000 rows and 2 MB per file. Source IDs are used only for duplicate checks; Kanbun assigns new issue
        identifiers.
      </p>
      <label>
        CSV file
        <input
          type="file"
          accept=".csv,text/csv"
          disabled={busy}
          onChange={(event) => void readFile(event.target.files?.[0])}
        />
      </label>
      {fileName && <p>Selected file: {fileName}</p>}
      {teams.length > 0 && (
        <label>
          Import into team
          <NativeSelect
            value={team?.id ?? ""}
            disabled={busy}
            onChange={(event) => {
              setTeamId(event.target.value);
              setImportResult(null);
            }}
          >
            {teams.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name} ({candidate.key})
              </option>
            ))}
          </NativeSelect>
        </label>
      )}
      {teams.length === 0 && <p>No active team is available to import issues into.</p>}
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {parsed && mapping && (
        <div>
          <h3>Review proposed columns</h3>
          <p>
            Kanbun matched headers by name. Change any selection before importing. Blank columns use the team’s default
            value.
          </p>
          <div className="github-connection-actions">
            {fieldOrder.map((field) => (
              <label key={field}>
                {fieldLabels[field]}
                <NativeSelect
                  value={mapping[field] === null ? "" : String(mapping[field])}
                  disabled={busy}
                  onChange={(event) => updateMapping(field, event.target.value)}
                >
                  <option value="">Do not map</option>
                  {parsed.headers.map((header, index) => (
                    <option
                      key={`${index}-${header}`}
                      value={index}
                      disabled={importFields.some((other) => other !== field && mapping[other] === index)}
                    >
                      {header} (column {index + 1})
                    </option>
                  ))}
                </NativeSelect>
              </label>
            ))}
          </div>
          {!mapping.title && (
            <p className="notice" role="alert">
              Map a column to Title to preview the import.
            </p>
          )}
          {mapping.title !== null && (
            <>
              <p role="status">
                {ready.length} ready · {duplicates} duplicate IDs skipped · {invalid.length} rows need correction or
                will be skipped.
              </p>
              {unmappedColumns.length > 0 && (
                <p>Ignored columns: {unmappedColumns.join(", ")}. Kanbun will not import these values.</p>
              )}
              {invalid.length > 0 && (
                <div aria-label="Rows requiring correction">
                  <h4>Rows requiring correction</h4>
                  <ul>
                    {invalid.slice(0, 20).map((row) => (
                      <li key={row.sourceRow}>
                        CSV row {row.sourceRow}: {row.errors.join(" ")}
                      </li>
                    ))}
                  </ul>
                  {invalid.length > 20 && <p>Showing 20 of {invalid.length} rows with errors.</p>}
                </div>
              )}
              {preview.length > 0 && (
                <table>
                  <thead>
                    <tr>
                      <th>CSV row</th>
                      <th>Title</th>
                      <th>Description</th>
                      <th>Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.slice(0, 8).map((row) => (
                      <tr key={row.sourceRow}>
                        <td>{row.sourceRow}</td>
                        <td>{row.record?.title ?? ""}</td>
                        <td>{row.record?.description ?? ""}</td>
                        <td>{rowErrors(row)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {preview.length > 8 && <p>Showing the first 8 of {preview.length} source rows.</p>}
              <Button variant="outline" disabled={busy || !team || ready.length === 0} onClick={importReadyRows}>
                {busy
                  ? `Importing ${ready.length} issues…`
                  : `Import ${ready.length} ready ${ready.length === 1 ? "issue" : "issues"}`}
              </Button>
            </>
          )}
        </div>
      )}
      {importResult && <p role="status">{importResult}</p>}
    </section>
  );
}
