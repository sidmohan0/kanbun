import { Command } from "commander";
import { api } from "../client.js";

export const draftCmd = new Command("draft").description("Manage drafts");

draftCmd
  .command("generate")
  .description("Generate drafts for a project")
  .requiredOption("--project <id>", "Project ID")
  .option("--template <id>", "Template ID for template-based drafts")
  .option("--agent", "Use LLM agent to write drafts")
  .option("--context <ctx>", "Additional context for agent")
  .option("--model <model>", "Model to use for agent drafts")
  .action(async (opts) => {
    if (opts.agent) {
      const result = await api("/api/drafts/generate", {
        method: "POST",
        body: JSON.stringify({
          project_id: Number(opts.project),
          mode: "agent",
          context: opts.context,
          model: opts.model,
        }),
      });
      console.log(`Generated ${result.count ?? 0} agent drafts.`);
    } else if (opts.template) {
      const result = await api("/api/drafts/generate", {
        method: "POST",
        body: JSON.stringify({
          project_id: Number(opts.project),
          mode: "template",
          template_id: Number(opts.template),
        }),
      });
      console.log(`Generated ${result.count ?? 0} template drafts.`);
    } else {
      console.error("Specify --template <id> or --agent");
      process.exit(1);
    }
  });

draftCmd
  .command("list")
  .description("List drafts")
  .option(
    "--status <status>",
    "Filter by status (pending_review, sent, skipped)"
  )
  .option("--project <id>", "Filter by project")
  .action(async (opts) => {
    const params = new URLSearchParams();
    if (opts.status) params.set("status", opts.status);
    if (opts.project) params.set("project_id", opts.project);
    const qs = params.toString();
    const drafts = await api(`/api/drafts${qs ? `?${qs}` : ""}`);
    if (drafts.length === 0) {
      console.log("No drafts found.");
      return;
    }
    for (const d of drafts) {
      console.log(`#${d.id} [${d.status}] ${d.draft_type} — ${d.subject}`);
    }
  });

draftCmd
  .command("preview <id>")
  .description("Preview a draft")
  .action(async (id: string) => {
    const draft = await api(`/api/drafts/${id}`);
    console.log(`Subject: ${draft.subject}`);
    console.log(`To: ${draft.email ?? "unknown"}`);
    console.log(`Type: ${draft.draft_type} | Status: ${draft.status}`);
    console.log(`---`);
    console.log(draft.body);
  });
