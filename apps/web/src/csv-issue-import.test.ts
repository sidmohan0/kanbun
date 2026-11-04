import { describe, expect, it } from "vitest";
import { parseCsv, previewCsvImport, proposeColumnMapping } from "./csv-issue-import";
import type { Row } from "@kanbun/model";

describe("issue CSV import preview", () => {
  it("parses BOM, quoted commas, embedded lines and escaped quotes without evaluating cells", () => {
    expect(parseCsv('\uFEFFTitle,Description\r\n"One, two","Line one\r\nLine ""two"""\r\n')).toEqual({
      headers: ["Title", "Description"],
      rows: [["One, two", 'Line one\r\nLine "two"']],
    });
    expect(parseCsv("Title\n=IMPORTXML(example)").rows[0]?.[0]).toContain("=IMPORTXML");
  });

  it("rejects malformed quoted data, inconsistent widths, empty headers and oversized imports", () => {
    expect(() => parseCsv('Title\n"unfinished')).toThrow(/ends inside a quoted/);
    expect(() => parseCsv("Title,Status\nOnly title")).toThrow(/expected 2/);
    expect(() => parseCsv("Title,,Priority\nA,B,C")).toThrow(/Every CSV column needs a header/);
    expect(() => parseCsv(`Title\n${Array.from({ length: 1_001 }, (_, i) => `Issue ${i}`).join("\n")}`)).toThrow(
      /row limit/,
    );
  });

  it("proposes unambiguous field mappings by familiar issue column names", () => {
    const mapping = proposeColumnMapping(["ID", "Team", "Title", "Description", "Status", "Priority", "Assignee"]);
    expect(mapping).toMatchObject({
      sourceIdentifier: 0,
      title: 2,
      description: 3,
      state: 4,
      priority: 5,
      assignee: 6,
    });
    expect(mapping.estimate).toBeNull();
    expect(proposeColumnMapping(["Issue", "Tags"]).labels).toBe(1);
  });

  it("maps values to the selected team's schema, detects identifier duplicates, and reports invalid values", () => {
    const parsed = parseCsv(
      "ID,Title,Description,Status,Priority,Estimate,Due Date,Assignee\n" +
        ["KAN-1", "Existing", "", "", "", "", "", ""].join(",") +
        "\n" +
        "OTHER-9,New task,Body,In Progress,High,3,2026-04-02,Ada Lovelace\n" +
        "OTHER-10,Bad task,,Unknown,urgent,-2,2026-04-31,Missing Person",
    );
    const mapping = proposeColumnMapping(parsed.headers);
    const team = { id: "team", key: "KAN" } as Row<"team">;
    const states = [{ id: "started", teamId: "team", name: "In Progress", archivedAt: null }] as Row<"workflowState">[];
    const members = [
      { id: "ada", active: true, displayName: "Ada Lovelace", name: "Ada", email: "ada@example.com", archivedAt: null },
    ] as Row<"user">[];
    const preview = previewCsvImport(parsed, mapping, team, states, members, [{ teamId: "team", identifier: "KAN-1" }]);
    expect(preview[0]).toMatchObject({ duplicate: true, errors: [] });
    expect(preview[1]).toMatchObject({
      duplicate: false,
      record: {
        title: "New task",
        description: "Body",
        stateId: "started",
        priority: 2,
        estimate: 3,
        dueDate: "2026-04-02",
        assigneeId: "ada",
      },
      errors: [],
    });
    expect(preview[2]?.errors).toEqual(
      expect.arrayContaining([
        "Status “Unknown” is not in this team.",
        "Estimate “-2” must be a non-negative number.",
        "Due date “2026-04-31” must use YYYY-MM-DD.",
        "Assignee “Missing Person” is not available.",
      ]),
    );
  });

  it("rejects inherited object property names as priority values", () => {
    const parsed = parseCsv("Title,Priority\nTask,constructor\nTask,toString\n");
    const mapping = proposeColumnMapping(parsed.headers);
    const team = { id: "team", key: "KAN" } as Row<"team">;

    const preview = previewCsvImport(parsed, mapping, team, [], [], []);

    expect(preview.map((row) => row.errors)).toEqual([
      ["Priority “constructor” is not recognized (use 0–4, none, urgent, high, medium, or low)."],
      ["Priority “toString” is not recognized (use 0–4, none, urgent, high, medium, or low)."],
    ]);
    expect(preview.map((row) => row.record?.priority)).toEqual([undefined, undefined]);
  });

  it("scopes duplicate identifiers to the selected team", () => {
    const parsed = parseCsv("ID,Title\nOTHER-1,Task\n");
    const mapping = proposeColumnMapping(parsed.headers);
    const team = { id: "team-b", key: "B" } as Row<"team">;

    const preview = previewCsvImport(parsed, mapping, team, [], [], [{ teamId: "team-a", identifier: "OTHER-1" }]);

    expect(preview[0]?.duplicate).toBe(false);
  });

  it("reports impossible ISO dates without throwing away the preview", () => {
    const parsed = parseCsv("Title,Due Date\nTask,9999-99-99\n");
    const preview = previewCsvImport(
      parsed,
      proposeColumnMapping(parsed.headers),
      { id: "team", key: "KAN" } as Row<"team">,
      [],
      [],
      [],
    );

    expect(preview[0]?.errors).toContain("Due date “9999-99-99” must use YYYY-MM-DD.");

    const lowYear = parseCsv("Title,Due Date\nTask,0001-01-01\n");
    const validPreview = previewCsvImport(
      lowYear,
      proposeColumnMapping(lowYear.headers),
      { id: "team", key: "KAN" } as Row<"team">,
      [],
      [],
      [],
    );
    expect(validPreview[0]).toMatchObject({ record: { dueDate: "0001-01-01" }, errors: [] });
  });

  it("requires title mapping and rejects ambiguous status or member values", () => {
    const parsed = parseCsv("ID,Title,Assignee\nX-1,Task,Alex\n");
    const mapping = proposeColumnMapping(parsed.headers);
    const team = { id: "team", key: "X" } as Row<"team">;
    expect(() => previewCsvImport(parsed, { ...mapping, title: null }, team, [], [], [])).toThrow(/Map a CSV column/);
    const ambiguous = previewCsvImport(
      parsed,
      mapping,
      team,
      [],
      [
        { id: "a", active: true, displayName: "Alex", name: "Alex", email: "a@example.com", archivedAt: null },
        { id: "b", active: true, displayName: "Alex", name: "Alex", email: "b@example.com", archivedAt: null },
      ] as Row<"user">[],
      [],
    );
    expect(ambiguous[0]?.errors).toContain("Assignee “Alex” is ambiguous.");
  });

  it("maps existing team or workspace labels and reports names that cannot be reconciled", () => {
    const parsed = parseCsv("Title,Labels\nBug fix,bug\n");
    const mapping = proposeColumnMapping(parsed.headers);
    const team = { id: "team", key: "KAN" } as Row<"team">;
    const preview = previewCsvImport(parsed, mapping, team, [], [], [], [
      { id: "label", teamId: "team", name: "bug", isGroup: false, archivedAt: null, retiredAt: null, parentId: null },
    ] as Row<"issueLabel">[]);
    expect(preview[0]?.record?.labelIds).toEqual(["label"]);
    expect(preview[0]?.errors).toEqual([]);
  });

  it("matches comma-containing exported labels and reports ambiguous segmentations", () => {
    const parsed = parseCsv('Title,Labels\nTask,"priority, high, customer request"\nTask,"one, two, three"\n');
    const mapping = proposeColumnMapping(parsed.headers);
    const team = { id: "team", key: "KAN" } as Row<"team">;
    const labels = [
      {
        id: "one-comma",
        teamId: "team",
        name: "priority, high",
        isGroup: false,
        archivedAt: null,
        retiredAt: null,
        parentId: null,
      },
      {
        id: "customer",
        teamId: "team",
        name: "customer request",
        isGroup: false,
        archivedAt: null,
        retiredAt: null,
        parentId: null,
      },
      { id: "one", teamId: "team", name: "one", isGroup: false, archivedAt: null, retiredAt: null, parentId: null },
      {
        id: "two-comma-three",
        teamId: "team",
        name: "two, three",
        isGroup: false,
        archivedAt: null,
        retiredAt: null,
        parentId: null,
      },
      {
        id: "one-comma-two",
        teamId: "team",
        name: "one, two",
        isGroup: false,
        archivedAt: null,
        retiredAt: null,
        parentId: null,
      },
      { id: "three", teamId: "team", name: "three", isGroup: false, archivedAt: null, retiredAt: null, parentId: null },
    ] as Row<"issueLabel">[];

    const preview = previewCsvImport(parsed, mapping, team, [], [], [], labels);

    expect(preview[0]).toMatchObject({ record: { labelIds: ["one-comma", "customer"] }, errors: [] });
    expect(preview[1]?.errors[0]).toMatch(/are ambiguous/);
  });
});
