import crypto from "node:crypto";
import { normalizeEmail, normalizeHeader } from "./csv";

export const importMappingFields = [
  "displayName",
  "firstName",
  "lastName",
  "email",
  "company",
  "title",
] as const;

export type ImportMappingField = (typeof importMappingFields)[number];

export const importMappingFieldLabels: Record<ImportMappingField, string> = {
  displayName: "Display name",
  firstName: "First name",
  lastName: "Last name",
  email: "Email",
  company: "Company",
  title: "Title",
};

const importFieldAliases: Record<ImportMappingField, readonly string[]> = {
  displayName: [
    "display_name",
    "displayname",
    "full_name",
    "fullname",
    "contact_name",
    "name",
  ],
  firstName: ["first_name", "firstname", "given_name", "givenname"],
  lastName: ["last_name", "lastname", "family_name", "familyname", "surname"],
  email: [
    "email",
    "email_address",
    "primary_email",
    "work_email",
    "personal_email",
  ],
  company: ["company", "company_name", "organization", "org", "employer"],
  title: ["title", "job_title", "jobtitle", "role", "position"],
};

export type ImportMapping = Record<ImportMappingField, string | null>;

type ParsedImportRow = {
  company: string | null;
  displayName: string;
  email: string | null;
  rawEmail: string | null;
  title: string | null;
};

function pickHeader(
  normalizedHeaders: Map<string, string>,
  aliases: readonly string[],
) {
  for (const alias of aliases) {
    const match = normalizedHeaders.get(alias);

    if (match) {
      return match;
    }
  }

  return null;
}

function cleanValue(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function isSuspiciousHeader(normalizedHeader: string) {
  return (
    normalizedHeader.length === 0 ||
    /^column_?\d+$/.test(normalizedHeader) ||
    /^unnamed(_column)?(_\d+)?$/.test(normalizedHeader)
  );
}

export function isImportMappingField(
  value: string,
): value is ImportMappingField {
  return importMappingFields.includes(value as ImportMappingField);
}

export function analyzeImportMapping(
  headers: string[],
  mapping: ImportMapping,
) {
  const selectedHeaders = Object.values(mapping).filter(
    (value): value is string => Boolean(value),
  );
  const selectedSet = new Set(selectedHeaders);
  const duplicateHeaders = selectedHeaders.filter(
    (header, index) => selectedHeaders.indexOf(header) !== index,
  );
  const unmappedHeaders = headers.filter((header) => !selectedSet.has(header));
  const warnings: string[] = [];

  if (!mapping.email) {
    warnings.push(
      "No email column detected. Deduplication will be limited to imported identities already on file.",
    );
  }

  if (!mapping.displayName && !mapping.firstName && !mapping.lastName) {
    warnings.push(
      "No name columns detected. Rows without email will be flagged during import.",
    );
  }

  if (duplicateHeaders.length > 0) {
    warnings.push(
      "The same source column is mapped to multiple fields. Review the mapping before confirming the import.",
    );
  }

  return {
    unmappedHeaders,
    warnings,
  };
}

export function detectImportMapping(headers: string[]) {
  const normalizedHeaders = new Map(
    headers.map((header) => [normalizeHeader(header), header]),
  );

  const mapping = importMappingFields.reduce<ImportMapping>(
    (accumulator, field) => {
      accumulator[field] = pickHeader(
        normalizedHeaders,
        importFieldAliases[field],
      );
      return accumulator;
    },
    {} as ImportMapping,
  );

  return {
    mapping,
    ...analyzeImportMapping(headers, mapping),
  };
}

export function sanitizeImportMapping(
  headers: string[],
  overrides: Partial<Record<ImportMappingField, string | null | undefined>>,
) {
  const headerSet = new Set(headers);

  return importMappingFields.reduce<ImportMapping>((accumulator, field) => {
    const value = overrides[field];
    accumulator[field] =
      value && headerSet.has(value) && value !== "__none__" ? value : null;
    return accumulator;
  }, {} as ImportMapping);
}

export function mapImportRow(
  headers: string[],
  row: string[],
  mapping: ImportMapping,
): ParsedImportRow {
  const values = Object.fromEntries(
    headers.map((header, index) => [header, row[index]?.trim() ?? ""]),
  );

  const displayName = cleanValue(
    (mapping.displayName ? values[mapping.displayName] : null) ??
      [
        mapping.firstName ? values[mapping.firstName] : null,
        mapping.lastName ? values[mapping.lastName] : null,
      ]
        .filter(Boolean)
        .join(" "),
  );
  const rawEmail = cleanValue(mapping.email ? values[mapping.email] : null);

  return {
    displayName: displayName ?? "",
    email: rawEmail && isValidEmail(rawEmail) ? normalizeEmail(rawEmail) : null,
    rawEmail,
    company: cleanValue(mapping.company ? values[mapping.company] : null),
    title: cleanValue(mapping.title ? values[mapping.title] : null),
  };
}

export function analyzeImportDataset(headers: string[], rows: string[][]) {
  const warnings: string[] = [];
  const normalizedHeaders = headers.map((header) => normalizeHeader(header));
  const suspiciousHeaders = headers.filter((_, index) =>
    isSuspiciousHeader(normalizedHeaders[index]),
  );
  const inconsistentRowCount = rows.filter((row) => row.length !== headers.length)
    .length;

  if (suspiciousHeaders.length > 0) {
    warnings.push(
      `Suspicious headers detected: ${suspiciousHeaders.join(", ")}. Rename them or map them manually before confirming the import.`,
    );
  }

  if (inconsistentRowCount > 0) {
    warnings.push(
      `${inconsistentRowCount} row${inconsistentRowCount === 1 ? "" : "s"} did not match the header column count exactly. Review flagged rows before confirming.`,
    );
  }

  for (const [index, header] of headers.entries()) {
    const nonEmptyCount = rows.reduce((count, row) => {
      const value = row[index]?.trim() ?? "";
      return value.length > 0 ? count + 1 : count;
    }, 0);

    if (nonEmptyCount === 0) {
      warnings.push(
        `Header "${header}" is empty across the entire file and can probably be left unmapped.`,
      );
      continue;
    }

    const sparseThreshold = Math.max(1, Math.floor(rows.length * 0.1));

    if (rows.length >= 5 && nonEmptyCount <= sparseThreshold) {
      warnings.push(
        `Header "${header}" only contains values in ${nonEmptyCount} of ${rows.length} rows.`,
      );
    }
  }

  return { warnings };
}

export function buildImportFileHash(csvText: string) {
  return crypto.createHash("sha256").update(csvText).digest("hex");
}

export function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function summarizeWarnings(warnings: string[]) {
  return warnings.length > 0 ? warnings.join(" ") : null;
}
