import { describe, expect, it } from "vitest";
import {
  analyzeImportDataset,
  analyzeImportMapping,
  buildImportFileHash,
  detectImportMapping,
  isValidEmail,
  mapImportRow,
  sanitizeImportMapping,
  summarizeWarnings,
} from "./import-utils";

describe("detectImportMapping", () => {
  it("detects common alias headers and unmapped columns", () => {
    const result = detectImportMapping([
      "Full Name",
      "Email Address",
      "Organization",
      "Notes",
    ]);

    expect(result.mapping.displayName).toBe("Full Name");
    expect(result.mapping.email).toBe("Email Address");
    expect(result.mapping.company).toBe("Organization");
    expect(result.unmappedHeaders).toEqual(["Notes"]);
    expect(result.warnings).toEqual([]);
  });

  it("warns when email and name columns are missing", () => {
    const result = detectImportMapping(["Company", "Role"]);

    expect(result.warnings).toHaveLength(2);
  });
});

describe("mapImportRow", () => {
  it("maps split first and last names into a display name", () => {
    const { mapping } = detectImportMapping([
      "First Name",
      "Last Name",
      "Primary Email",
      "Company",
      "Title",
    ]);

    const row = mapImportRow(
      ["First Name", "Last Name", "Primary Email", "Company", "Title"],
      ["Alex", "Park", "alex@example.com", "Northline", "Founder"],
      mapping,
    );

    expect(row).toEqual({
      displayName: "Alex Park",
      email: "alex@example.com",
      rawEmail: "alex@example.com",
      company: "Northline",
      title: "Founder",
    });
  });
});

describe("sanitizeImportMapping", () => {
  it("keeps only valid headers and drops sentinels", () => {
    const mapping = sanitizeImportMapping(["Name", "Email"], {
      displayName: "Name",
      email: "Email",
      company: "__none__",
      title: "Unknown",
    });

    expect(mapping).toEqual({
      displayName: "Name",
      firstName: null,
      lastName: null,
      email: "Email",
      company: null,
      title: null,
    });
  });
});

describe("analyzeImportMapping", () => {
  it("warns when the same header is mapped more than once", () => {
    const result = analyzeImportMapping(["Name", "Email"], {
      displayName: "Name",
      firstName: null,
      lastName: null,
      email: "Email",
      company: "Name",
      title: null,
    });

    expect(result.warnings).toContain(
      "The same source column is mapped to multiple fields. Review the mapping before confirming the import.",
    );
  });
});

describe("analyzeImportDataset", () => {
  it("warns on suspicious and empty columns", () => {
    const result = analyzeImportDataset(
      ["Column 1", "Email", "Notes"],
      [
        ["", "alex@example.com", ""],
        ["", "jamie@example.com", ""],
      ],
    );

    expect(result.warnings).toContain(
      'Suspicious headers detected: Column 1. Rename them or map them manually before confirming the import.',
    );
    expect(result.warnings).toContain(
      'Header "Column 1" is empty across the entire file and can probably be left unmapped.',
    );
    expect(result.warnings).toContain(
      'Header "Notes" is empty across the entire file and can probably be left unmapped.',
    );
  });
});

describe("buildImportFileHash", () => {
  it("is stable for the same file contents", () => {
    expect(buildImportFileHash("name,email\nAlex,alex@example.com")).toBe(
      buildImportFileHash("name,email\nAlex,alex@example.com"),
    );
  });
});

describe("isValidEmail", () => {
  it("checks for basic email validity", () => {
    expect(isValidEmail("alex@example.com")).toBe(true);
    expect(isValidEmail("alex@example")).toBe(false);
  });
});

describe("summarizeWarnings", () => {
  it("joins warnings into a single review string", () => {
    expect(summarizeWarnings(["A", "B"])).toBe("A B");
    expect(summarizeWarnings([])).toBeNull();
  });
});
