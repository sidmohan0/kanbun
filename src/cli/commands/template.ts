import { Command } from "commander";
import { api } from "../client.js";

export const templateCmd = new Command("template").description(
  "Manage templates"
);

templateCmd
  .command("create")
  .description("Create a template")
  .requiredOption("--project <id>", "Project ID")
  .requiredOption("--name <name>", "Template name")
  .requiredOption("--subject <subject>", "Email subject (supports {{vars}})")
  .requiredOption("--body <body>", "Email body (supports {{vars}})")
  .option("--vars <vars>", "Comma-separated variable names")
  .action(async (opts) => {
    const variables = opts.vars
      ? opts.vars.split(",").map((v: string) => v.trim())
      : [];
    const template = await api("/api/templates", {
      method: "POST",
      body: JSON.stringify({
        project_id: Number(opts.project),
        name: opts.name,
        subject: opts.subject,
        body: opts.body,
        variables,
      }),
    });
    console.log(`Created template #${template.id}: ${template.name}`);
  });

templateCmd
  .command("list")
  .description("List templates")
  .option("--project <id>", "Filter by project")
  .action(async (opts) => {
    const qs = opts.project ? `?project_id=${opts.project}` : "";
    const templates = await api(`/api/templates${qs}`);
    if (templates.length === 0) {
      console.log("No templates found.");
      return;
    }
    for (const t of templates) {
      console.log(`#${t.id} ${t.name} [${t.variables.join(", ")}]`);
    }
  });
