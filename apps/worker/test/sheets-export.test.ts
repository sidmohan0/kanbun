import { expect, it } from "vitest";
import { MemoryStore } from "@kanbun/sync";
import { sheetsExport } from "../src/sheets-export";

it("exports public projects without disclosing private relationships or disabled project contents", () => {
  const store = new MemoryStore();
  store.table("team").set("public", { id: "public", key: "PUB", name: "Public", visibility: "public" });
  store.table("team").set("secret", { id: "secret", key: "SECRET", name: "Secret team", visibility: "private" });
  store
    .table("project")
    .set("shared", { id: "shared", name: "Shared project", description: "Shared description", priority: 1 });
  store
    .table("project")
    .set("secret", { id: "secret", name: "Secret project", description: "Secret description", priority: 1 });
  store.table("projectTeam").set("one", { projectId: "shared", teamId: "public" });
  store.table("projectTeam").set("two", { projectId: "shared", teamId: "secret" });
  store.table("projectTeam").set("three", { projectId: "secret", teamId: "secret" });
  store
    .table("projectTeam")
    .set("retired-link", { projectId: "secret", teamId: "public", archivedAt: "2026-11-01T00:00:00Z" });
  store.table("projectStatus").set("private-status", { id: "private-status", teamId: "secret", name: "Secret status" });
  store.table("project").get("shared")!.statusId = "private-status";
  store.table("issue").set("public", {
    id: "public",
    teamId: "public",
    number: 1,
    title: "Public issue",
    projectId: "secret",
    parentId: "secret",
    priority: 1,
  });
  store.table("issue").set("secret", { id: "secret", teamId: "secret", number: 1, title: "Secret issue" });
  const exported = JSON.stringify(sheetsExport(store, true, true));
  expect(exported).toContain("Shared project");
  expect(exported).toContain("Public issue");
  for (const privateValue of [
    "Secret team",
    "Secret project",
    "Secret description",
    "Secret issue",
    "Secret status",
    "SECRET-1",
  ])
    expect(exported).not.toContain(privateValue);
  expect(sheetsExport(store, true, false)[1]!.values).toHaveLength(1);
  expect(sheetsExport(store, false, true)[0]!.values).toHaveLength(1);
  expect(sheetsExport(store, false, true)[0]!.values[0]).toContain("Title");
  const projectsOnly = sheetsExport(store, false, true);
  expect(JSON.stringify(projectsOnly[0]!.values)).not.toContain("Public issue");
  expect(JSON.stringify(projectsOnly[1]!.values)).toContain("Shared project");
  expect(JSON.stringify(projectsOnly)).not.toContain("Secret");
  const disabled = sheetsExport(store, false, false);
  expect(disabled.map((sheet) => sheet.values)).toEqual([[disabled[0]!.values[0]], [disabled[1]!.values[0]]]);
});
