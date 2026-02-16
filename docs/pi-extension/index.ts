/**
 * Kanbun CRM Manager — Pi Extension
 *
 * Turns pi into a daily CRM manager by exposing Kanbun's services as
 * tools with permission gates on dangerous actions (sending email,
 * bulk operations, Apollo credit usage).
 *
 * The extension auto-starts the Apollo MCP server as a background
 * child process if it's not already running. It's health-checked,
 * and gracefully killed on session shutdown.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";

// ── Kanbun project root (adjust if needed) ──────────────────────────
const KANBUN_ROOT = "/Users/sid/projects/kanbun";
// Prefer the dev DB if it exists, fall back to the production Electron user-data location
const DEV_DB = path.join(KANBUN_ROOT, "data", "kanbun.db");
const PROD_DB = path.join(
  process.env.HOME ?? "/Users/sid",
  "Library",
  "Application Support",
  "kanbun",
  "kanbun.db"
);
const DB_PATH = fs.existsSync(DEV_DB) ? DEV_DB : PROD_DB;
const APOLLO_SERVER = "http://localhost:3001";

const APOLLO_MCP_DIR = path.join(KANBUN_ROOT, "kanbun-apollo-mcp");
const APOLLO_LOG_PATH = path.join(KANBUN_ROOT, "data", "apollo-mcp.log");
const APOLLO_STARTUP_TIMEOUT_MS = 10_000;
const APOLLO_HEALTH_INTERVAL_MS = 60_000;

// ── Rate-limit state ────────────────────────────────────────────────
let apolloCallsThisSession = 0;
const APOLLO_SESSION_LIMIT = 25;

// ── Apollo process management ───────────────────────────────────────

async function isApolloRunning(): Promise<boolean> {
  try {
    const res = await fetch(`${APOLLO_SERVER}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function startApolloProcess(): { proc: ChildProcess; logStream: fs.WriteStream } {
  const logStream = fs.createWriteStream(APOLLO_LOG_PATH, { flags: "a" });
  const timestamp = () => new Date().toISOString();

  logStream.write(`\n--- Apollo MCP started by pi at ${timestamp()} ---\n`);

  const proc = spawn("npx", ["tsx", "src/index.ts"], {
    cwd: APOLLO_MCP_DIR,
    stdio: ["ignore", "pipe", "pipe"],
    // detached so it doesn't block pi's exit if cleanup fails
    detached: process.platform !== "win32",
    env: { ...process.env },
    shell: process.platform === "win32",
  });

  proc.stdout?.on("data", (data: Buffer) => {
    logStream.write(`[stdout] ${data.toString()}`);
  });

  proc.stderr?.on("data", (data: Buffer) => {
    logStream.write(`[stderr] ${data.toString()}`);
  });

  proc.on("exit", (code, signal) => {
    logStream.write(`--- Apollo MCP exited (code=${code}, signal=${signal}) at ${timestamp()} ---\n`);
    logStream.end();
  });

  return { proc, logStream };
}

async function waitForApolloHealthy(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isApolloRunning()) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

export default function (pi: ExtensionAPI) {
  // We lazy-init services so the extension loads even if the DB
  // doesn't exist yet (first run, etc.)
  let _services: ReturnType<typeof initServices> | null = null;
  let apolloProc: ChildProcess | null = null;
  let apolloLogStream: fs.WriteStream | null = null;
  let apolloHealthTimer: ReturnType<typeof setInterval> | null = null;
  let apolloManagedByUs = false;

  function svc() {
    if (!_services) _services = initServices();
    return _services;
  }

  // ================================================================
  // APOLLO LIFECYCLE
  // ================================================================

  pi.on("session_start", async (_event, ctx) => {
    // Check if Apollo is already running (user started it manually)
    if (await isApolloRunning()) {
      ctx.ui.setStatus("apollo", "Apollo MCP ✓ (external)");
      return;
    }

    // Check if the Apollo MCP directory exists and has a .env
    const envPath = path.join(APOLLO_MCP_DIR, ".env");
    if (!fs.existsSync(envPath)) {
      ctx.ui.setStatus("apollo", "Apollo MCP ✗ (no .env)");
      ctx.ui.notify(
        `Apollo MCP not configured — missing ${envPath}. Apollo tools won't work.`,
        "warning"
      );
      return;
    }

    // Start it
    ctx.ui.setStatus("apollo", "Apollo MCP starting…");
    try {
      const { proc, logStream } = startApolloProcess();
      apolloProc = proc;
      apolloLogStream = logStream;
      apolloManagedByUs = true;

      const healthy = await waitForApolloHealthy(APOLLO_STARTUP_TIMEOUT_MS);
      if (healthy) {
        ctx.ui.setStatus("apollo", "Apollo MCP ✓");
        ctx.ui.notify("Apollo MCP server started", "info");
      } else {
        ctx.ui.setStatus("apollo", "Apollo MCP ✗ (timeout)");
        ctx.ui.notify(
          `Apollo MCP didn't respond within ${APOLLO_STARTUP_TIMEOUT_MS / 1000}s. Check ${APOLLO_LOG_PATH}`,
          "warning"
        );
      }
    } catch (err: any) {
      ctx.ui.setStatus("apollo", "Apollo MCP ✗ (error)");
      ctx.ui.notify(`Failed to start Apollo MCP: ${err.message}`, "error");
    }

    // Periodic health check — update status indicator
    apolloHealthTimer = setInterval(async () => {
      const ok = await isApolloRunning();
      ctx.ui.setStatus("apollo", ok ? "Apollo MCP ✓" : "Apollo MCP ✗ (down)");

      // If we started it and it died, try to restart once
      if (!ok && apolloManagedByUs && apolloProc?.exitCode !== null) {
        ctx.ui.notify("Apollo MCP died — restarting…", "warning");
        try {
          const { proc, logStream } = startApolloProcess();
          apolloProc = proc;
          apolloLogStream = logStream;
          const healthy = await waitForApolloHealthy(APOLLO_STARTUP_TIMEOUT_MS);
          ctx.ui.setStatus("apollo", healthy ? "Apollo MCP ✓ (restarted)" : "Apollo MCP ✗ (restart failed)");
        } catch {
          ctx.ui.setStatus("apollo", "Apollo MCP ✗ (restart failed)");
        }
      }
    }, APOLLO_HEALTH_INTERVAL_MS);
  });

  pi.on("session_shutdown", async () => {
    // Clear health timer
    if (apolloHealthTimer) {
      clearInterval(apolloHealthTimer);
      apolloHealthTimer = null;
    }

    // Kill Apollo if we started it
    if (apolloProc && apolloManagedByUs) {
      try {
        // Graceful: SIGTERM, then force after 3s
        apolloProc.kill("SIGTERM");
        await new Promise<void>((resolve) => {
          const forceTimer = setTimeout(() => {
            if (apolloProc && !apolloProc.killed) {
              apolloProc.kill("SIGKILL");
            }
            resolve();
          }, 3000);
          apolloProc!.on("exit", () => {
            clearTimeout(forceTimer);
            resolve();
          });
        });
      } catch {
        // Best-effort
      }
      apolloProc = null;
    }

    if (apolloLogStream) {
      apolloLogStream.end();
      apolloLogStream = null;
    }
  });

  // Command to check Apollo status / view logs
  pi.registerCommand("apollo", {
    description: "Show Apollo MCP server status and recent logs",
    handler: async (_args, ctx) => {
      const running = await isApolloRunning();
      let msg = `**Apollo MCP Status:** ${running ? "✅ Running" : "❌ Down"}\n`;
      msg += `**Managed by pi:** ${apolloManagedByUs ? "Yes" : "No (external)"}\n`;
      msg += `**Server URL:** ${APOLLO_SERVER}\n`;
      msg += `**Log file:** ${APOLLO_LOG_PATH}\n`;
      msg += `**Session API calls:** ${apolloCallsThisSession}/${APOLLO_SESSION_LIMIT}`;

      if (fs.existsSync(APOLLO_LOG_PATH)) {
        const log = fs.readFileSync(APOLLO_LOG_PATH, "utf-8");
        const lastLines = log.split("\n").slice(-15).join("\n");
        msg += `\n\n**Recent logs:**\n\`\`\`\n${lastLines}\n\`\`\``;
      }
      ctx.ui.notify(msg, "info");
    },
  });

  // ================================================================
  // PERMISSION GATES
  // ================================================================

  pi.on("tool_call", async (event, ctx) => {
    // ── Gate: email_send — ALWAYS confirm ─────────────────────────
    if (event.toolName === "email_send") {
      const { to, subject, body } = event.input as any;
      const ok = await ctx.ui.confirm(
        "📧 Send Email?",
        `To: ${to}\nSubject: ${subject}\n\n${(body as string)?.slice(0, 300)}${(body as string)?.length > 300 ? "..." : ""}`
      );
      if (!ok) return { block: true, reason: "User declined to send email" };
    }

    // ── Gate: drafts_approve — show draft, confirm ────────────────
    if (event.toolName === "drafts_approve") {
      const { draft_id } = event.input as any;
      const draft = svc().draftService.getById(draft_id);
      if (draft) {
        const contact = svc().contactService.getById(draft.contact_id);
        const contactName = contact
          ? `${contact.first_name} ${contact.last_name} (${contact.email})`
          : `Contact #${draft.contact_id}`;
        const ok = await ctx.ui.confirm(
          "✅ Approve Draft?",
          `To: ${contactName}\nSubject: ${draft.subject}\n\n${draft.body.slice(0, 400)}${draft.body.length > 400 ? "..." : ""}`
        );
        if (!ok) return { block: true, reason: "User declined to approve draft" };
      }
    }

    // ── Gate: bulk contact import — confirm if many ───────────────
    if (event.toolName === "contacts_import_csv") {
      const { rows } = event.input as any;
      if (rows && rows.length > 10) {
        const ok = await ctx.ui.confirm(
          "📋 Bulk Import",
          `About to import ${rows.length} contacts. Continue?`
        );
        if (!ok) return { block: true, reason: "User cancelled bulk import" };
      }
    }

    // ── Gate: Apollo — rate limit per session ─────────────────────
    if (
      event.toolName === "apollo_search" ||
      event.toolName === "apollo_enrich" ||
      event.toolName === "apollo_enrich_org"
    ) {
      apolloCallsThisSession++;
      if (apolloCallsThisSession > APOLLO_SESSION_LIMIT) {
        const ok = await ctx.ui.confirm(
          "⚠️ Apollo Rate Limit",
          `You've made ${apolloCallsThisSession} Apollo calls this session (limit: ${APOLLO_SESSION_LIMIT}). Continue?`
        );
        if (!ok) return { block: true, reason: "Apollo rate limit — user declined" };
      }
    }

    // ── Gate: BLOCK credential/account changes entirely ──────────
    if (event.toolName === "email_accounts_add" || event.toolName === "email_accounts_update_credentials") {
      return { block: true, reason: "Email account management is admin-only. Use the Kanbun UI or CLI." };
    }
  });

  // ================================================================
  // SYSTEM PROMPT INJECTION
  // ================================================================

  pi.on("before_agent_start", async (event, _ctx) => {
    return {
      systemPrompt: event.systemPrompt + CRM_SYSTEM_PROMPT,
    };
  });

  // ================================================================
  // COMMANDS
  // ================================================================

  pi.registerCommand("daily", {
    description: "Run the daily CRM morning routine",
    handler: async (_args, ctx) => {
      pi.sendUserMessage(DAILY_PROMPT);
    },
  });

  pi.registerCommand("pipeline", {
    description: "Show pipeline status for a project",
    handler: async (args, ctx) => {
      const projectId = args?.trim();
      if (projectId) {
        pi.sendUserMessage(`Show me the full pipeline status for project ${projectId}. Use pipeline_status tool.`);
      } else {
        pi.sendUserMessage("List all projects and their pipeline status. Use projects_list and pipeline_status tools.");
      }
    },
  });

  pi.registerCommand("drafts", {
    description: "Review pending drafts",
    handler: async (_args, ctx) => {
      pi.sendUserMessage("Show me all pending drafts that need my review. Use drafts_list with status pending_review.");
    },
  });

  // ================================================================
  // TOOLS — Projects
  // ================================================================

  pi.registerTool({
    name: "projects_list",
    label: "Projects",
    description: "List all outreach projects with their pipeline stages, cadence, and send account",
    parameters: Type.Object({}),
    async execute() {
      const projects = svc().projectService.list();
      const accounts = svc().accountService.list();
      const summary = projects.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        stages: p.pipeline_stages,
        follow_up_cadence_days: p.follow_up_cadence,
        send_account: accounts.find((a) => a.id === p.default_send_account_id)?.email_address ?? null,
      }));
      return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
    },
  });

  // ================================================================
  // TOOLS — Contacts
  // ================================================================

  pi.registerTool({
    name: "contacts_list",
    label: "Contacts",
    description: "List contacts for a project, optionally filtered by pipeline stage",
    parameters: Type.Object({
      project_id: Type.Number({ description: "Project ID" }),
      stage: Type.Optional(Type.String({ description: "Filter by pipeline stage" })),
    }),
    async execute(_id, params) {
      const contacts = svc().contactService.listByProject(params.project_id, params.stage);
      return { content: [{ type: "text", text: JSON.stringify(contacts, null, 2) }] };
    },
  });

  pi.registerTool({
    name: "contacts_add",
    label: "Add Contact",
    description: "Add a single contact and optionally assign to a project",
    parameters: Type.Object({
      first_name: Type.String(),
      last_name: Type.String(),
      email: Type.String(),
      company: Type.Optional(Type.String()),
      title: Type.Optional(Type.String()),
      linkedin_url: Type.Optional(Type.String()),
      notes: Type.Optional(Type.String()),
      source: StringEnum(["manual", "csv", "apollo"] as const),
      project_id: Type.Optional(Type.Number({ description: "Assign to project" })),
      stage: Type.Optional(Type.String({ description: "Initial pipeline stage (default: first stage)" })),
    }),
    async execute(_id, params) {
      const contact = svc().contactService.add({
        first_name: params.first_name,
        last_name: params.last_name,
        email: params.email,
        company: params.company,
        title: params.title,
        linkedin_url: params.linkedin_url,
        notes: params.notes,
        source: params.source,
      });
      if (params.project_id) {
        const project = svc().projectService.getById(params.project_id);
        const stage = params.stage ?? project?.pipeline_stages?.[0] ?? "New";
        svc().contactService.assignToProject(contact.id, params.project_id, stage);
      }
      return { content: [{ type: "text", text: `✅ Added contact ${contact.first_name} ${contact.last_name} (ID: ${contact.id})` }] };
    },
  });

  pi.registerTool({
    name: "contacts_move_stage",
    label: "Move Stage",
    description: "Move a contact to a different pipeline stage",
    parameters: Type.Object({
      contact_id: Type.Number(),
      project_id: Type.Number(),
      new_stage: Type.String({ description: "Target pipeline stage" }),
    }),
    async execute(_id, params) {
      svc().contactService.moveStage(params.contact_id, params.project_id, params.new_stage);
      const contact = svc().contactService.getById(params.contact_id);
      return {
        content: [{ type: "text", text: `Moved ${contact?.first_name} ${contact?.last_name} → ${params.new_stage}` }],
      };
    },
  });

  pi.registerTool({
    name: "contacts_import_csv",
    label: "Import CSV",
    description: "Import contacts from CSV data (array of row objects with first_name, last_name, email, company, title, etc.)",
    parameters: Type.Object({
      rows: Type.Array(Type.Record(Type.String(), Type.String())),
      project_id: Type.Optional(Type.Number({ description: "Assign all to this project" })),
      stage: Type.Optional(Type.String({ description: "Initial pipeline stage" })),
    }),
    async execute(_id, params) {
      const contacts = svc().contactService.importCsv(params.rows);
      if (params.project_id) {
        const project = svc().projectService.getById(params.project_id);
        const stage = params.stage ?? project?.pipeline_stages?.[0] ?? "New";
        for (const c of contacts) {
          svc().contactService.assignToProject(c.id, params.project_id, stage);
        }
      }
      return { content: [{ type: "text", text: `✅ Imported ${contacts.length} contacts` }] };
    },
  });

  // ================================================================
  // TOOLS — Drafts
  // ================================================================

  pi.registerTool({
    name: "drafts_list",
    label: "List Drafts",
    description: "List drafts by status: pending_review, approved, sent, skipped",
    parameters: Type.Object({
      status: StringEnum(["pending_review", "approved", "sent", "skipped"] as const),
      project_id: Type.Optional(Type.Number({ description: "Filter by project" })),
    }),
    async execute(_id, params) {
      let drafts = svc().draftService.listByStatus(params.status);
      if (params.project_id) {
        drafts = drafts.filter((d) => d.project_id === params.project_id);
      }
      // Enrich with contact info
      const enriched = drafts.map((d) => {
        const contact = svc().contactService.getById(d.contact_id);
        return {
          id: d.id,
          contact: contact ? `${contact.first_name} ${contact.last_name} <${contact.email}>` : `#${d.contact_id}`,
          subject: d.subject,
          body_preview: d.body.slice(0, 150) + (d.body.length > 150 ? "..." : ""),
          sequence_step: d.sequence_step,
          created_at: d.created_at,
        };
      });
      return { content: [{ type: "text", text: JSON.stringify(enriched, null, 2) }] };
    },
  });

  pi.registerTool({
    name: "drafts_generate",
    label: "Generate Drafts",
    description:
      "Use the LLM orchestrator to generate outreach drafts for contacts in a project that don't have pending drafts. Returns the number generated.",
    parameters: Type.Object({
      project_id: Type.Number(),
      context: Type.Optional(Type.String({ description: "Extra context for the LLM" })),
      contact_ids: Type.Optional(Type.Array(Type.Number(), { description: "Specific contacts (default: all without pending)" })),
    }),
    async execute(_id, params) {
      const { Orchestrator } = await import(path.join(KANBUN_ROOT, "dist", "src", "agent", "orchestrator.js"));
      const orchestrator = new Orchestrator(svc().db);
      const count = await orchestrator.generateDrafts({
        projectId: params.project_id,
        context: params.context,
        contactIds: params.contact_ids,
      });
      return { content: [{ type: "text", text: `✅ Generated ${count} draft(s). Use drafts_list with status pending_review to review them.` }] };
    },
  });

  pi.registerTool({
    name: "drafts_show",
    label: "Show Draft",
    description: "Show the full content of a specific draft",
    parameters: Type.Object({
      draft_id: Type.Number(),
    }),
    async execute(_id, params) {
      const draft = svc().draftService.getById(params.draft_id);
      if (!draft) return { content: [{ type: "text", text: "Draft not found" }], isError: true };
      const contact = svc().contactService.getById(draft.contact_id);
      const result = {
        id: draft.id,
        status: draft.status,
        contact: contact ? `${contact.first_name} ${contact.last_name} <${contact.email}>` : `#${draft.contact_id}`,
        subject: draft.subject,
        body: draft.body,
        sequence_step: draft.sequence_step,
        draft_type: draft.draft_type,
        created_at: draft.created_at,
      };
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  });

  pi.registerTool({
    name: "drafts_edit",
    label: "Edit Draft",
    description: "Update the subject and/or body of a pending draft",
    parameters: Type.Object({
      draft_id: Type.Number(),
      subject: Type.Optional(Type.String()),
      body: Type.Optional(Type.String()),
    }),
    async execute(_id, params) {
      const draft = svc().draftService.getById(params.draft_id);
      if (!draft) return { content: [{ type: "text", text: "Draft not found" }], isError: true };
      svc().draftService.updateContent(
        params.draft_id,
        params.subject ?? draft.subject,
        params.body ?? draft.body
      );
      return { content: [{ type: "text", text: `✅ Updated draft ${params.draft_id}` }] };
    },
  });

  pi.registerTool({
    name: "drafts_approve",
    label: "Approve Draft",
    description: "Approve a draft for sending (will prompt for confirmation)",
    parameters: Type.Object({
      draft_id: Type.Number(),
    }),
    async execute(_id, params) {
      svc().draftService.updateStatus(params.draft_id, "approved");
      return { content: [{ type: "text", text: `✅ Draft ${params.draft_id} approved` }] };
    },
  });

  pi.registerTool({
    name: "drafts_skip",
    label: "Skip Draft",
    description: "Skip a draft (won't be sent)",
    parameters: Type.Object({
      draft_id: Type.Number(),
    }),
    async execute(_id, params) {
      svc().draftService.updateStatus(params.draft_id, "skipped");
      return { content: [{ type: "text", text: `Skipped draft ${params.draft_id}` }] };
    },
  });

  // ================================================================
  // TOOLS — Email Send
  // ================================================================

  pi.registerTool({
    name: "email_send",
    label: "Send Email",
    description:
      "Send an approved draft via Gmail or Outlook. ALWAYS requires user confirmation. The draft must be in 'approved' status.",
    parameters: Type.Object({
      draft_id: Type.Number({ description: "ID of an approved draft to send" }),
    }),
    async execute(_id, params) {
      const draft = svc().draftService.getById(params.draft_id);
      if (!draft) return { content: [{ type: "text", text: "Draft not found" }], isError: true };
      if (draft.status !== "approved") {
        return { content: [{ type: "text", text: `Draft status is "${draft.status}" — must be "approved" first` }], isError: true };
      }

      const contact = svc().contactService.getById(draft.contact_id);
      if (!contact) return { content: [{ type: "text", text: "Contact not found" }], isError: true };

      const { EmailService } = await import(path.join(KANBUN_ROOT, "dist", "src", "services", "email.js"));
      const emailService = new EmailService(svc().db);
      const result = await emailService.send(draft.send_account_id, contact.email, draft.subject, draft.body);

      svc().draftService.updateStatus(draft.id, "sent");
      svc().draftService.setThreadId(draft.id, result.threadId);

      return {
        content: [{ type: "text", text: `📧 Sent to ${contact.first_name} ${contact.last_name} <${contact.email}>` }],
        details: { messageId: result.messageId, threadId: result.threadId },
      };
    },
  });

  // ================================================================
  // TOOLS — Reply Sync
  // ================================================================

  pi.registerTool({
    name: "sync_replies",
    label: "Sync Replies",
    description: "Check all sent emails for replies and auto-move contacts to Replied stage",
    parameters: Type.Object({}),
    async execute() {
      const { SyncService } = await import(path.join(KANBUN_ROOT, "dist", "src", "services", "sync.js"));
      const sync = new SyncService(svc().db);
      await sync.pollReplies();
      return { content: [{ type: "text", text: "✅ Reply sync complete" }] };
    },
  });

  // ================================================================
  // TOOLS — Pipeline Status
  // ================================================================

  pi.registerTool({
    name: "pipeline_status",
    label: "Pipeline Status",
    description: "Get a summary of where all contacts stand in a project's pipeline",
    parameters: Type.Object({
      project_id: Type.Number(),
    }),
    async execute(_id, params) {
      const project = svc().projectService.getById(params.project_id);
      if (!project) return { content: [{ type: "text", text: "Project not found" }], isError: true };

      const allContacts = svc().contactService.listByProject(params.project_id);
      const pendingDrafts = svc().draftService.listByStatus("pending_review").filter((d) => d.project_id === params.project_id);
      const approvedDrafts = svc().draftService.listByStatus("approved").filter((d) => d.project_id === params.project_id);

      // Group contacts by stage
      const byStage: Record<string, number> = {};
      for (const c of allContacts) {
        byStage[c.current_stage] = (byStage[c.current_stage] || 0) + 1;
      }

      const summary = {
        project: project.name,
        total_contacts: allContacts.length,
        contacts_by_stage: byStage,
        pending_drafts: pendingDrafts.length,
        approved_ready_to_send: approvedDrafts.length,
        pipeline_stages: project.pipeline_stages,
        follow_up_cadence_days: project.follow_up_cadence,
      };

      return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
    },
  });

  // ================================================================
  // TOOLS — Follow-Up Check
  // ================================================================

  pi.registerTool({
    name: "followup_check",
    label: "Check Follow-ups",
    description: "Run the follow-up scheduler to generate overdue follow-up drafts",
    parameters: Type.Object({}),
    async execute() {
      const { FollowUpScheduler } = await import(path.join(KANBUN_ROOT, "dist", "src", "agent", "scheduler.js"));
      const scheduler = new FollowUpScheduler(svc().db);
      const count = await scheduler.check();
      return { content: [{ type: "text", text: count > 0 ? `📋 Generated ${count} follow-up draft(s)` : "No follow-ups due right now" }] };
    },
  });

  // ================================================================
  // TOOLS — GTM Report
  // ================================================================

  pi.registerTool({
    name: "gtm_report",
    label: "GTM Report",
    description: "Show weekly actuals (contacts added, emails sent, replies, meetings) for a project",
    parameters: Type.Object({
      project_id: Type.Number(),
    }),
    async execute(_id, params) {
      const { GtmService } = await import(path.join(KANBUN_ROOT, "dist", "src", "services", "gtm.js"));
      const gtm = new GtmService(svc().db);
      const actuals = gtm.getActuals(params.project_id);
      if (actuals.length === 0) {
        return { content: [{ type: "text", text: "No weekly data yet for this project" }] };
      }
      // Show last 4 weeks + totals
      const recent = actuals.slice(-4);
      const totals = actuals.reduce(
        (acc, w) => ({
          contactsAdded: acc.contactsAdded + w.contactsAdded,
          emailsSent: acc.emailsSent + w.emailsSent,
          replies: acc.replies + w.replies,
          meetings: acc.meetings + w.meetings,
        }),
        { contactsAdded: 0, emailsSent: 0, replies: 0, meetings: 0 }
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ recent_weeks: recent, all_time_totals: totals, total_weeks: actuals.length }, null, 2),
          },
        ],
      };
    },
  });

  // ================================================================
  // TOOLS — Apollo
  // ================================================================

  pi.registerTool({
    name: "apollo_search",
    label: "Apollo Search",
    description: "Search Apollo for people by keyword query. Requires paid Apollo plan. Rate-limited.",
    parameters: Type.Object({
      query: Type.String({ description: "Search keywords (name, title, company, etc.)" }),
      limit: Type.Optional(Type.Number({ description: "Max results (default 25)" })),
    }),
    async execute(_id, params) {
      const res = await fetch(`${APOLLO_SERVER}/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: params.query, limit: params.limit ?? 25 }),
      });
      const data = await res.json();
      if (data.error) return { content: [{ type: "text", text: `Apollo error: ${data.error}` }], isError: true };
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    },
  });

  pi.registerTool({
    name: "apollo_enrich",
    label: "Apollo Enrich",
    description: "Enrich a person by email via Apollo (get company, title, LinkedIn, etc.)",
    parameters: Type.Object({
      email: Type.String({ description: "Email to enrich" }),
    }),
    async execute(_id, params) {
      const res = await fetch(`${APOLLO_SERVER}/enrich`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: params.email }),
      });
      const data = await res.json();
      if (data.error) return { content: [{ type: "text", text: `Apollo error: ${data.error}` }], isError: true };
      return { content: [{ type: "text", text: data ? JSON.stringify(data, null, 2) : "No match found" }] };
    },
  });

  pi.registerTool({
    name: "apollo_enrich_org",
    label: "Apollo Enrich Org",
    description: "Enrich an organization by domain via Apollo (get industry, size, etc.)",
    parameters: Type.Object({
      domain: Type.String({ description: "Company domain (e.g. acme.com)" }),
    }),
    async execute(_id, params) {
      const res = await fetch(`${APOLLO_SERVER}/enrich-org`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: params.domain }),
      });
      const data = await res.json();
      if (data.error) return { content: [{ type: "text", text: `Apollo error: ${data.error}` }], isError: true };
      return { content: [{ type: "text", text: data ? JSON.stringify(data, null, 2) : "No match found" }] };
    },
  });

  // ================================================================
  // TOOLS — Email Accounts (read-only)
  // ================================================================

  pi.registerTool({
    name: "email_accounts_list",
    label: "Email Accounts",
    description: "List connected email accounts (Gmail/Outlook). Read-only — credentials are not exposed.",
    parameters: Type.Object({}),
    async execute() {
      const accounts = svc().accountService.list();
      return { content: [{ type: "text", text: JSON.stringify(accounts, null, 2) }] };
    },
  });

  // ================================================================
  // TOOLS — Templates
  // ================================================================

  pi.registerTool({
    name: "templates_list",
    label: "List Templates",
    description: "List email templates for a project",
    parameters: Type.Object({
      project_id: Type.Number(),
    }),
    async execute(_id, params) {
      const { TemplateService } = await import(path.join(KANBUN_ROOT, "dist", "src", "services", "template.js"));
      const templateSvc = new TemplateService(svc().db);
      const templates = templateSvc.listByProject(params.project_id);
      return { content: [{ type: "text", text: JSON.stringify(templates, null, 2) }] };
    },
  });
}

// ====================================================================
// SERVICE INITIALIZATION
// ====================================================================

function initServices() {
  // Dynamic imports to resolve from Kanbun's directory
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Database = require("better-sqlite3");
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // We import the service classes lazily so we can construct them
  // with our db handle. The services are simple classes — no side effects.
  const { ProjectService } = require(path.join(KANBUN_ROOT, "dist", "src", "services", "project.js"));
  const { ContactService } = require(path.join(KANBUN_ROOT, "dist", "src", "services", "contact.js"));
  const { DraftService } = require(path.join(KANBUN_ROOT, "dist", "src", "services", "draft.js"));
  const { EmailAccountService } = require(path.join(KANBUN_ROOT, "dist", "src", "services", "email-account.js"));

  return {
    db,
    projectService: new ProjectService(db) as InstanceType<typeof ProjectService>,
    contactService: new ContactService(db) as InstanceType<typeof ContactService>,
    draftService: new DraftService(db) as InstanceType<typeof DraftService>,
    accountService: new EmailAccountService(db) as InstanceType<typeof EmailAccountService>,
  };
}

// ====================================================================
// PROMPTS
// ====================================================================

const CRM_SYSTEM_PROMPT = `

## Kanbun CRM Manager Role

You are Sid's personal CRM manager. Your job is to manage his go-to-market outreach pipeline using the Kanbun tools available to you.

### Your Responsibilities
1. **Morning routine** — When asked (or via /daily), check replies, generate follow-ups, and present a dashboard
2. **Draft management** — Generate, review, edit, and help approve outreach emails
3. **Pipeline management** — Track contacts through stages, identify stalled leads
4. **Apollo research** — Enrich contacts and find new prospects (be mindful of API credits)
5. **Reporting** — Provide GTM metrics and weekly summaries

### Rules
- **NEVER send an email without explicit user approval** — the permission gate will enforce this, but you should also always ask
- **Show drafts before approving** — always use drafts_show so the user sees the full content
- **Be concise in summaries** — use tables and bullet points
- **Flag anomalies** — if reply rates drop, follow-ups are overdue, or pipeline is stalled, say so
- **Protect Apollo credits** — prefer enriching specific contacts over broad searches
- **One email account per project** — don't mix accounts

### Daily Routine Flow
1. sync_replies → check for new responses
2. followup_check → generate any overdue follow-up drafts
3. pipeline_status → for each active project
4. drafts_list (pending_review) → show what needs attention
5. Present a summary and ask what to focus on

### Pipeline Stage Conventions
Typical stages: New → Contacted → Replied → Meeting → Closed
When a reply is detected, sync_replies auto-moves to "Replied".
`;

const DAILY_PROMPT = `Run my daily CRM routine:

1. First, sync replies across all email accounts
2. Check for any overdue follow-ups and generate drafts
3. Get pipeline status for each project
4. List any pending drafts that need my review
5. Give me a concise morning briefing with:
   - New replies since last check
   - Follow-ups generated
   - Pipeline snapshot (contacts per stage)
   - Drafts waiting for review
   - Any concerns or recommendations`;
