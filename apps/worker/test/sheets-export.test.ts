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
    .table("issue")
    .set("public", {
      id: "public",
      teamId: "public",
      number: 1,
      title: "Public issue",
      projectId: "secret",
      parentId: "secret",
      priority: 1,
    });
  store.table("issue").set("secret", { id: "secret", teamId: "secret", number: 1, title: "Secret issue" });
  const exported = JSON.stringify(sheetsExport(store, true));
  expect(exported).toContain("Shared project");
  expect(exported).toContain("Public issue");
  for (const privateValue of ["Secret team", "Secret project", "Secret description", "Secret issue", "SECRET-1"])
    expect(exported).not.toContain(privateValue);
  expect(sheetsExport(store, false)[1]!.values).toHaveLength(1);
});
