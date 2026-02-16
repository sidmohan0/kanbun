import { Command } from "commander";
import { api } from "../client.js";
import fs from "node:fs";
import { parse } from "csv-parse/sync";

export const contactCmd = new Command("contact").description("Manage contacts");

contactCmd
  .command("add")
  .description("Add a contact")
  .requiredOption("--name <name>", "Full name (First Last)")
  .requiredOption("--email <email>", "Email address")
  .option("--company <company>", "Company name")
  .option("--title <title>", "Job title")
  .action(async (opts) => {
    const parts = opts.name.split(" ");
    const first_name = parts[0];
    const last_name = parts.slice(1).join(" ") || "";
    const contact = await api("/api/contacts", {
      method: "POST",
      body: JSON.stringify({
        first_name,
        last_name,
        email: opts.email,
        company: opts.company,
        title: opts.title,
        source: "manual",
      }),
    });
    console.log(
      `Added contact #${contact.id}: ${contact.first_name} ${contact.last_name}`
    );
  });

contactCmd
  .command("import")
  .description("Import contacts from CSV")
  .requiredOption("--csv <path>", "Path to CSV file")
  .option("--project <id>", "Project to assign contacts to")
  .option("--stage <stage>", "Initial pipeline stage", "Researched")
  .option("--dedupe <mode>", "Duplicate strategy: skip|update", "skip")
  .action(async (opts) => {
    const content = fs.readFileSync(opts.csv, "utf-8");
    const rows = parse(content, { columns: true, skip_empty_lines: true });
    const dedupeMode = opts.dedupe === "update" ? "update" : "skip";
    const result = await api("/api/contacts/import", {
      method: "POST",
      body: JSON.stringify({
        rows,
        project_id: opts.project ? Number(opts.project) : undefined,
        stage: opts.stage,
        dedupe_mode: dedupeMode,
      }),
    });
    let count = 0;
    if (Array.isArray(result)) {
      count = result.length;
    } else if (result.summary) {
      count = result.summary.inserted + result.summary.updated;
    } else if (typeof result.count === "number") {
      count = result.count;
    }
    console.log(`Imported ${count} contacts.`);
  });

contactCmd
  .command("list")
  .description("List contacts")
  .option("--project <id>", "Filter by project")
  .option("--stage <stage>", "Filter by stage")
  .action(async (opts) => {
    let path = "/api/contacts";
    const params = new URLSearchParams();
    if (opts.project) params.set("project_id", opts.project);
    if (opts.stage) params.set("stage", opts.stage);
    const qs = params.toString();
    if (qs) path += `?${qs}`;
    const contacts = await api(path);
    if (contacts.length === 0) {
      console.log("No contacts found.");
      return;
    }
    for (const c of contacts) {
      const stage = c.current_stage ? ` [${c.current_stage}]` : "";
      console.log(
        `#${c.id} ${c.first_name} ${c.last_name} <${c.email}>${stage}`
      );
    }
  });

contactCmd
  .command("move <contact-id>")
  .description("Move contact to a new stage")
  .requiredOption("--project <id>", "Project ID")
  .requiredOption("--stage <stage>", "Target stage")
  .action(async (contactId: string, opts) => {
    await api(`/api/contacts/${contactId}/stage`, {
      method: "PATCH",
      body: JSON.stringify({
        project_id: Number(opts.project),
        stage: opts.stage,
      }),
    });
    console.log(`Contact #${contactId} moved to stage: ${opts.stage}`);
  });
