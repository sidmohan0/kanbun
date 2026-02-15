import { Command } from "commander";
import { api } from "../client.js";

export const projectCmd = new Command("project").description("Manage projects");

projectCmd
  .command("create <name>")
  .description("Create a new project")
  .action(async (name: string) => {
    const project = await api("/api/projects", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    console.log(`Created project #${project.id}: ${project.name}`);
  });

projectCmd
  .command("list")
  .description("List all projects")
  .action(async () => {
    const projects = await api("/api/projects");
    if (projects.length === 0) {
      console.log("No projects yet.");
      return;
    }
    for (const p of projects) {
      console.log(`#${p.id} ${p.name} [${p.pipeline_stages.join(" → ")}]`);
    }
  });

projectCmd
  .command("set-stages <id> <stages>")
  .description("Set pipeline stages (comma-separated)")
  .action(async (id: string, stages: string) => {
    const project = await api(`/api/projects/${id}/stages`, {
      method: "PATCH",
      body: JSON.stringify({ stages: stages.split(",").map((s) => s.trim()) }),
    });
    console.log(`Stages set: ${project.pipeline_stages.join(" → ")}`);
  });

projectCmd
  .command("set-cadence <id> <days>")
  .description("Set follow-up cadence (comma-separated days)")
  .action(async (id: string, days: string) => {
    const cadence = days.split(",").map((d) => Number(d.trim()));
    const project = await api(`/api/projects/${id}/cadence`, {
      method: "PATCH",
      body: JSON.stringify({ cadence }),
    });
    console.log(`Cadence set: follow up at days ${project.follow_up_cadence.join(", ")}`);
  });

projectCmd
  .command("set-account <id> <account-id>")
  .description("Set default email account for a project")
  .action(async (id: string, accountId: string) => {
    await api(`/api/projects/${id}/account`, {
      method: "PATCH",
      body: JSON.stringify({ account_id: Number(accountId) }),
    });
    console.log("Default send account updated.");
  });
