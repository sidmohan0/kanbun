import type { Row } from "@kanbun/model";

export const MAX_IMPORT_ROWS = 1_000;
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

export const importFields = [
  "sourceIdentifier",
  "title",
  "description",
  "state",
  "priority",
  "estimate",
  "dueDate",
  "assignee",
  "labels",
] as const;

export type ImportField = (typeof importFields)[number];
export type ImportRecord = {
  title: string;
  description?: string | null;
  stateId?: string;
  priority?: 0 | 1 | 2 | 3 | 4;
  estimate?: number | null;
  dueDate?: string | null;
  assigneeId?: string;
  labelIds?: string[];
};
export type ParsedCsv = { headers: string[]; rows: string[][] };
export type ImportPreviewRow = { sourceRow: number; record?: ImportRecord; duplicate: boolean; errors: string[] };

const fieldAliases: Record<ImportField, string[]> = {
  sourceIdentifier: ["id", "identifier", "issue id", "issue identifier", "key"],
  title: ["title", "issue title", "summary", "subject", "name"],
  description: ["description", "details", "body"],
  state: ["status", "state", "workflow state"],
  priority: ["priority", "urgency"],
  estimate: ["estimate", "points", "story points"],
  dueDate: ["due date", "duedate", "deadline"],
  assignee: ["assignee", "assigned to", "owner"],
  labels: ["labels", "tags"],
};

/** RFC 4180-style CSV reader. It keeps every cell as text and never evaluates formulas. */
export function parseCsv(source: string): ParsedCsv {
  const text = source.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let closedQuote = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
        closedQuote = true;
      } else cell += char;
      continue;
    }
    if (closedQuote && char !== "," && char !== "\r" && char !== "\n")
      throw new Error("A quoted CSV value has unexpected text after its closing quote.");
    if (char === '"') {
      if (cell.length > 0 || closedQuote) throw new Error("A quote appears in an unquoted CSV value.");
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
      closedQuote = false;
    } else if (char === "\r" || char === "\n") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      cell = "";
      closedQuote = false;
      if (row.some((value) => value.trim() !== "")) rows.push(row);
      row = [];
    } else cell += char;
  }
  if (quoted) throw new Error("The CSV ends inside a quoted value.");
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    if (row.some((value) => value.trim() !== "")) rows.push(row);
  }
  const headers = rows.shift()?.map((header) => header.trim()) ?? [];
  if (!headers.length || headers.every((header) => !header)) throw new Error("The CSV needs a header row.");
  if (headers.length > 100) throw new Error("The CSV has too many columns. The limit is 100.");
  if (headers.some((header) => !header)) throw new Error("Every CSV column needs a header.");
  if (rows.length > MAX_IMPORT_ROWS)
    throw new Error(`The CSV exceeds the ${MAX_IMPORT_ROWS.toLocaleString()} row limit.`);
  for (const [index, values] of rows.entries()) {
    if (values.length !== headers.length)
      throw new Error(`CSV row ${index + 2} has ${values.length} cells; expected ${headers.length}.`);
  }
  if (!rows.length) throw new Error("The CSV has headers but no issue rows.");
  return { headers, rows };
}

const normalized = (value: string) =>
  value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");

export function proposeColumnMapping(headers: string[]): Record<ImportField, number | null> {
  const result = Object.fromEntries(importFields.map((field) => [field, null])) as Record<ImportField, number | null>;
  const used = new Set<number>();
  for (const field of importFields) {
    const aliases = new Set(fieldAliases[field].map(normalized));
    const match = headers.findIndex((header, index) => !used.has(index) && aliases.has(normalized(header)));
    if (match >= 0) {
      result[field] = match;
      used.add(match);
    }
  }
  return result;
}

function parsePriority(value: string): 0 | 1 | 2 | 3 | 4 | null {
  const text = normalized(value);
  const named: Record<string, 0 | 1 | 2 | 3 | 4> = { none: 0, urgent: 1, high: 2, medium: 3, normal: 3, low: 4 };
  if (Object.hasOwn(named, text)) return named[text]!;
  if (/^[0-4]$/.test(value.trim())) return Number(value.trim()) as 0 | 1 | 2 | 3 | 4;
  return null;
}

function validDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function previewCsvImport(
  parsed: ParsedCsv,
  mapping: Record<ImportField, number | null>,
  team: Row<"team">,
  states: Row<"workflowState">[],
  members: Row<"user">[],
  existingIdentifiers: { teamId: string; identifier: string }[],
  labels: Row<"issueLabel">[] = [],
): ImportPreviewRow[] {
  if (mapping.title === null) throw new Error("Map a CSV column to Title before continuing.");
  const stateByName = new Map<string, Row<"workflowState">[]>();
  for (const state of states.filter((candidate) => candidate.teamId === team.id && !candidate.archivedAt)) {
    const key = normalized(state.name);
    stateByName.set(key, [...(stateByName.get(key) ?? []), state]);
  }
  const membersByName = new Map<string, Row<"user">[]>();
  for (const member of members.filter((candidate) => candidate.active && !candidate.archivedAt)) {
    for (const name of [member.displayName, member.name, member.email].filter((value): value is string =>
      Boolean(value),
    )) {
      const key = normalized(name);
      const matches = membersByName.get(key) ?? [];
      if (!matches.some((match) => match.id === member.id)) membersByName.set(key, [...matches, member]);
    }
  }
  const labelsByName = new Map<string, Row<"issueLabel">[]>();
  for (const label of labels.filter(
    (candidate) =>
      !candidate.archivedAt &&
      !candidate.retiredAt &&
      !candidate.isGroup &&
      (!candidate.teamId || candidate.teamId === team.id),
  )) {
    const key = normalized(label.name);
    labelsByName.set(key, [...(labelsByName.get(key) ?? []), label]);
  }
  const existingTeamIdentifiers = new Set(
    existingIdentifiers.filter((entry) => entry.teamId === team.id).map((entry) => entry.identifier.toUpperCase()),
  );
  const seenIdentifiers = new Set<string>();
  return parsed.rows.map((cells, index) => {
    const value = (field: ImportField) => {
      const column = mapping[field];
      return column === null ? "" : (cells[column] ?? "").trim();
    };
    const errors: string[] = [];
    const title = value("title");
    if (!title) errors.push("Title is required.");
    if (title.length > 500) errors.push("Title exceeds 500 characters.");
    const record: ImportRecord = { title };
    const description = value("description");
    if (mapping.description !== null) record.description = description || null;
    const stateName = value("state");
    if (stateName) {
      const matches = stateByName.get(normalized(stateName)) ?? [];
      if (matches.length !== 1)
        errors.push(
          matches.length ? `Status “${stateName}” is ambiguous.` : `Status “${stateName}” is not in this team.`,
        );
      else record.stateId = matches[0]!.id;
    }
    const priority = value("priority");
    if (priority) {
      const parsedPriority = parsePriority(priority);
      if (parsedPriority === null)
        errors.push(`Priority “${priority}” is not recognized (use 0–4, none, urgent, high, medium, or low).`);
      else record.priority = parsedPriority;
    }
    const estimate = value("estimate");
    if (estimate) {
      const number = Number(estimate);
      if (!Number.isFinite(number) || number < 0) errors.push(`Estimate “${estimate}” must be a non-negative number.`);
      else record.estimate = number;
    }
    const dueDate = value("dueDate");
    if (dueDate) {
      if (!validDate(dueDate)) errors.push(`Due date “${dueDate}” must use YYYY-MM-DD.`);
      else record.dueDate = dueDate;
    }
    const assignee = value("assignee");
    if (assignee) {
      const matches = membersByName.get(normalized(assignee)) ?? [];
      if (matches.length !== 1)
        errors.push(
          matches.length > 1 ? `Assignee “${assignee}” is ambiguous.` : `Assignee “${assignee}” is not available.`,
        );
      else record.assigneeId = matches[0]!.id;
    }
    const labelsValue = value("labels");
    if (labelsValue) {
      const labelIds: string[] = [];
      const singleSelectGroups = new Set<string>();
      const cells = labelsValue.split(",").map((part) => part.trim());
      const paths: Row<"issueLabel">[][] = [];
      const findPaths = (start: number, path: Row<"issueLabel">[]) => {
        if (paths.length > 1) return;
        if (start === cells.length) {
          paths.push(path);
          return;
        }
        for (let end = start; end < cells.length; end += 1) {
          const name = cells.slice(start, end + 1).join(", ");
          for (const label of labelsByName.get(normalized(name)) ?? []) findPaths(end + 1, [...path, label]);
        }
      };
      findPaths(0, []);
      if (paths.length !== 1) {
        errors.push(
          paths.length > 1
            ? `Labels “${labelsValue}” are ambiguous; adjust the CSV value so it maps to one unique set of labels.`
            : `Label “${labelsValue}” is not available in this team.`,
        );
      } else {
        for (const label of paths[0]!) {
          if (labelIds.includes(label.id)) continue;
          const group = label.parentId ? labels.find((candidate) => candidate.id === label.parentId) : undefined;
          if (group?.groupType === "single" && singleSelectGroups.has(group.id))
            errors.push(`Only one label from “${group.name}” can be applied.`);
          else {
            if (group?.groupType === "single") singleSelectGroups.add(group.id);
            labelIds.push(label.id);
          }
        }
      }
      if (labelIds.length) record.labelIds = labelIds;
    }
    const identifier = value("sourceIdentifier").toUpperCase();
    const duplicate = Boolean(
      identifier && (existingTeamIdentifiers.has(identifier) || seenIdentifiers.has(identifier)),
    );
    if (identifier) seenIdentifiers.add(identifier);
    return { sourceRow: index + 2, record, duplicate, errors };
  });
}
