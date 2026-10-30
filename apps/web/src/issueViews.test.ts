import { describe, expect, it } from "vitest";
import type { Row } from "@kanbun/model";
import { emptyIssueFilters, visibleIssues } from "./issueViews";

const issue = (id: string, patch: Partial<Row<"issue">> = {}) =>
  ({
    id,
    teamId: "team",
    number: Number(id),
    title: `Issue ${id}`,
    description: null,
    assigneeId: null,
    stateId: "todo",
    priority: 0,
    sortOrder: `a${id}`,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    archivedAt: null,
    trashed: false,
    ...patch,
  }) as Row<"issue">;
const teams = [{ id: "team", key: "KAN" }] as Row<"team">[];
function select(issues: Row<"issue">[], patch = {}, extra = {}) {
  return visibleIssues({
    issues,
    teams,
    labelLinks: [],
    actorId: "me",
    view: "all",
    filters: { ...emptyIssueFilters(), ...patch },
    ...extra,
  }).map((row) => row.id);
}

describe("authorized local issue views", () => {
  it("combines identifier/title/description search with property and label filters", () => {
    const rows = [
      issue("1", { title: "Fix bootstrap", description: "日本語 recovery", priority: 2, assigneeId: "me" }),
      issue("2", { title: "Other recovery", priority: 2 }),
      issue("3", { title: "Fix bootstrap", description: "日本語", priority: 1 }),
    ];
    const links = [{ id: "link", issueId: "1", labelId: "bug", archivedAt: null }] as Row<"issueLabelLink">[];
    expect(
      select(
        rows,
        { search: "KAN-1 日本語 bootstrap", stateId: "todo", assigneeId: "me", priority: "2", labelId: "bug" },
        { labelLinks: links },
      ),
    ).toEqual(["1"]);
    expect(select(rows, { search: "missing" })).toEqual([]);
    expect(select(rows, { assigneeId: "unassigned" })).toEqual(["2", "3"]);
    expect(select(rows, { priority: "0" })).toEqual([]);
  });
  it("My Issues requires the current actor and cannot be widened by an assignee filter", () => {
    const rows = [issue("1", { assigneeId: "me" }), issue("2", { assigneeId: "other" }), issue("3")];
    expect(select(rows, { assigneeId: "other" }, { view: "mine" })).toEqual(["1"]);
    expect(select(rows, {}, { view: "mine", actorId: null })).toEqual([]);
    expect(select([issue("1", { assigneeId: "me", archivedAt: "2026-01-01" }), issue("2", { trashed: true })])).toEqual(
      [],
    );
  });
  it("orders priorities with None last and stabilizes equal values by manual order and id", () => {
    const rows = [
      issue("4", { priority: 4 }),
      issue("2", { priority: 1 }),
      issue("1"),
      issue("3", { priority: 2 }),
      issue("5", { priority: 1 }),
    ];
    expect(select(rows, { order: "priority" })).toEqual(["2", "5", "3", "4", "1"]);
    expect(select(rows)).toEqual(["1", "2", "3", "4", "5"]);
    expect(rows.map((row) => row.id)).toEqual(["4", "2", "1", "3", "5"]);
  });
  it("orders dates and titles without changing the caller's working set", () => {
    const rows = [
      issue("1", { title: "Zebra", createdAt: "2026-01-02", updatedAt: "2026-01-01" }),
      issue("2", { title: "Alpha", createdAt: "2026-01-01", updatedAt: "2026-01-03" }),
    ];
    expect(select(rows, { order: "newest" })).toEqual(["1", "2"]);
    expect(select(rows, { order: "updated" })).toEqual(["2", "1"]);
    expect(select(rows, { order: "title" })).toEqual(["2", "1"]);
  });
});
