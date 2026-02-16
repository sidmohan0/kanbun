# Building Role-Based Agents with Pi: A Practitioner's Checklist

*Based on building the Kanbun CRM Manager extension — lessons and patterns for constraining agents to specific jobs.*

---

## The Mental Model

A role-based agent is **not** just a system prompt. It's the combination of:

1. **Tools** — what actions the agent can take
2. **Gates** — what actions require human approval or are blocked entirely
3. **Identity** — the system prompt that defines behavior and workflow
4. **Lifecycle** — background services, health checks, startup/shutdown
5. **Commands** — user-facing shortcuts for common workflows

Think of it like hiring someone: you give them a job description (identity), desk and computer access (tools), security clearances (gates), and onboarding docs (commands).

---

## Checklist

### Phase 1: Map the Domain

Before writing any code, answer these questions:

- [ ] **What existing services/APIs does the agent need?** List every external system (databases, APIs, email providers, etc.)
- [ ] **What are the dangerous actions?** Anything that sends data externally, costs money, deletes data, or is irreversible
- [ ] **What's the daily workflow?** The sequence of actions a human would do manually
- [ ] **What data does the agent need to read vs. write?** This determines read-only vs. read-write tools
- [ ] **Who is the human in the loop?** What decisions must always be escalated?

**Kanbun example:**
- Services: SQLite (contacts, drafts, projects), Gmail API, Outlook API, Apollo API
- Dangerous: sending emails, approving drafts, Apollo API calls (credits), deleting contacts
- Daily workflow: check replies → generate follow-ups → pipeline status → review drafts
- Read vs. write: pipeline status is read-only; draft generation is write
- Human in loop: every email send, every draft approval

### Phase 2: Design the Tool Surface

- [ ] **One tool per atomic action** — don't combine "search and import" into one tool. Keep them separate so gates can be granular.
- [ ] **Name tools clearly** — the LLM reads the name and description. `contacts_move_stage` is better than `update_contact`.
- [ ] **Include context in tool output** — when listing drafts, include contact name/email, not just IDs. The agent needs context to make decisions.
- [ ] **Constrain parameters with enums** — use `StringEnum` for fixed options (status values, provider types). Prevents hallucinated values.
- [ ] **Return actionable text** — tool results should tell the agent what to do next ("Use drafts_list to review them").

**Pattern — tool categories for any role-based agent:**

| Category | Examples | Typical gate |
|----------|----------|-------------|
| **Read/query** | list contacts, pipeline status, search | None (safe) |
| **Create** | add contact, generate draft | Confirm if bulk |
| **Modify** | edit draft, move pipeline stage | Log + notify |
| **Send/external** | send email, API calls | Always confirm |
| **Delete/destructive** | remove contact, clear data | Block or double-confirm |
| **Admin/config** | change accounts, modify settings | Block entirely |

### Phase 3: Design Permission Gates

This is the most important part. Gates are implemented via `pi.on("tool_call", ...)`.

- [ ] **Identify the "never without asking" actions** — these get `ctx.ui.confirm()` gates that always fire
- [ ] **Identify the "block entirely" actions** — return `{ block: true }` unconditionally
- [ ] **Identify rate-limited actions** — track call count per session, warn at threshold
- [ ] **Identify bulk-sensitive actions** — check input size, confirm if above threshold
- [ ] **Show context in confirmation dialogs** — don't just say "Send email?" — show recipient, subject, body preview

**Gate implementation patterns:**

```typescript
// ALWAYS CONFIRM — for irreversible external actions
pi.on("tool_call", async (event, ctx) => {
  if (event.toolName === "email_send") {
    const ok = await ctx.ui.confirm("Send Email?", `To: ${event.input.to}\n...`);
    if (!ok) return { block: true, reason: "User declined" };
  }
});

// BLOCK ENTIRELY — for admin-only actions
if (event.toolName === "accounts_modify") {
  return { block: true, reason: "Admin only — use the UI" };
}

// RATE LIMIT — for metered APIs
if (event.toolName === "apollo_search") {
  callCount++;
  if (callCount > LIMIT) {
    const ok = await ctx.ui.confirm("Rate limit", `${callCount} calls. Continue?`);
    if (!ok) return { block: true, reason: "Rate limit" };
  }
}

// BULK CHECK — confirm large operations
if (event.toolName === "contacts_import" && event.input.rows?.length > 10) {
  const ok = await ctx.ui.confirm("Bulk import", `${event.input.rows.length} contacts`);
  if (!ok) return { block: true, reason: "Cancelled bulk operation" };
}
```

### Phase 4: Write the System Prompt

- [ ] **Define the role clearly** — "You are Sid's CRM manager" not "You are a helpful assistant"
- [ ] **List responsibilities** — numbered, specific
- [ ] **State rules explicitly** — especially around dangerous actions ("NEVER send without approval")
- [ ] **Define the daily routine** — step-by-step workflow the agent should follow
- [ ] **Set conventions** — stage names, naming patterns, output format preferences
- [ ] **Inject via `before_agent_start`** — this appends to the system prompt every turn

**Prompt structure template:**

```markdown
## [Role Name] Role

You are [owner]'s [role]. Your job is to [one sentence].

### Responsibilities
1. [Primary duty]
2. [Secondary duty]
...

### Rules
- NEVER [dangerous thing] without user approval
- Always [safety behavior]
- [Format preferences]

### Daily Routine
1. [First step]
2. [Second step]
...

### Conventions
- [Domain-specific terminology and patterns]
```

### Phase 5: Add Lifecycle Management

- [ ] **Background services** — if the agent depends on external servers, start them automatically on `session_start`
- [ ] **Health checks** — periodic polling to verify dependencies are alive
- [ ] **Auto-restart** — if a managed service dies, restart once
- [ ] **Graceful shutdown** — clean up on `session_shutdown`
- [ ] **Status indicators** — use `ctx.ui.setStatus()` to show dependency health in the footer

**Pattern — managed sidecar:**

```typescript
pi.on("session_start", async (_event, ctx) => {
  if (await isServiceRunning()) {
    ctx.ui.setStatus("svc", "Service ✓ (external)");
    return; // Already running, don't manage it
  }
  // Start it, health check, set status
});

pi.on("session_shutdown", async () => {
  if (managedByUs) kill(proc);
});
```

- [ ] **Cross-platform process spawning** — use Node's `child_process.spawn`, not tmux. Set `detached: true` on Unix, `shell: true` on Windows.
- [ ] **Log to file** — pipe stdout/stderr to a log file the user can inspect
- [ ] **Add a status command** — `/servicename` to check health and recent logs

### Phase 6: Add User Commands

Commands are shortcuts for common workflows. They send user messages that trigger the agent.

- [ ] **`/daily` or `/morning`** — kick off the routine workflow
- [ ] **`/status` or `/pipeline`** — quick dashboard
- [ ] **`/review`** — show items needing attention
- [ ] **Service-specific commands** — `/apollo`, `/drafts`, etc.

**Pattern:**

```typescript
pi.registerCommand("daily", {
  description: "Run the daily routine",
  handler: async (_args, ctx) => {
    pi.sendUserMessage("Run my daily routine: [detailed steps]");
  },
});
```

### Phase 7: Handle State and Dependencies

- [ ] **Import existing code directly** — don't rewrite services. Import your compiled TypeScript/JS.
- [ ] **Lazy-init services** — so the extension loads even if the DB doesn't exist yet
- [ ] **Handle native modules** — if you use native deps (like `better-sqlite3`), add a `package.json` to the extension directory and `npm install`
- [ ] **Path resolution** — compiled TS output may be in `dist/src/` not `dist/`. Verify import paths.
- [ ] **Database location** — support both dev paths and production paths (Electron user data, etc.)

### Phase 8: Test Incrementally

1. [ ] **Load test** — does `pi` start without errors with the extension loaded?
2. [ ] **Read-only tools** — test listing, querying, status tools first
3. [ ] **Gates** — verify confirm dialogs appear for dangerous actions
4. [ ] **Blocks** — verify admin actions are blocked
5. [ ] **Write tools** — test creating drafts, adding contacts
6. [ ] **External tools** — test email send (with gate), API calls
7. [ ] **Daily workflow** — run `/daily` end-to-end
8. [ ] **Edge cases** — empty database, missing credentials, service down

---

## Common Pitfalls

### 1. Gates that don't show enough context
**Bad:** "Send email? [Yes/No]"
**Good:** "Send to Jane Chen <jane@acme.vc>?\nSubject: Quick question about Series A\n\n[first 300 chars of body]"

### 2. Forgetting to gate bulk operations
The agent might decide to approve and send 30 emails in a loop. Gate individual sends AND batch operations.

### 3. Not handling service failures gracefully
If Apollo is down, the agent shouldn't crash — it should report the error and continue with tools that work.

### 4. Overly broad tools
A tool that does "search, enrich, and import" in one call can't be gated at the import step. Keep tools atomic.

### 5. Trusting the LLM with credentials
Never expose API keys or OAuth tokens in tool results. The `email_accounts_list` tool returns names and addresses, not credentials.

### 6. Forgetting about session state
Pi sessions persist. If the agent generates drafts in one session and you resume later, the pending drafts are still in the DB but the agent doesn't know about them unless you tell it to check.

### 7. Not rebuilding after code changes
If your extension imports from compiled TypeScript (`dist/`), you need to `npm run build` after changing service code. The extension imports `.js` files, not `.ts`.

---

## Extension File Structure

```
~/.pi/agent/extensions/your-agent/
├── index.ts           # Main extension (tools, gates, lifecycle, commands)
├── package.json       # If you need npm dependencies (native modules, etc.)
└── node_modules/      # After npm install
```

For more complex agents, split into files:

```
~/.pi/agent/extensions/your-agent/
├── index.ts           # Entry point — wires everything together
├── tools/
│   ├── contacts.ts    # Contact-related tools
│   ├── drafts.ts      # Draft-related tools
│   └── email.ts       # Email tools
├── gates.ts           # All permission gates
├── lifecycle.ts       # Service management (start/stop/health)
├── prompts.ts         # System prompt and command prompts
├── package.json
└── node_modules/
```

---

## Extending to Multiple Roles

To support multiple roles in one extension:

```typescript
type Role = "crm_manager" | "researcher" | "admin";
let currentRole: Role = "crm_manager";

pi.registerCommand("role", {
  handler: async (_args, ctx) => {
    const choice = await ctx.ui.select("Select role:", ["crm_manager", "researcher", "admin"]);
    if (choice) {
      currentRole = choice as Role;
      // Reconfigure tools based on role
      const toolSets: Record<Role, string[]> = {
        crm_manager: ["contacts_list", "drafts_generate", "email_send", ...],
        researcher: ["contacts_list", "apollo_search", "apollo_enrich", ...],
        admin: pi.getAllTools().map(t => t.name),
      };
      pi.setActiveTools(toolSets[currentRole]);
      ctx.ui.notify(`Switched to ${currentRole}`, "info");
    }
  },
});

// Gates that respect roles
pi.on("tool_call", async (event, ctx) => {
  if (currentRole === "researcher" && event.toolName === "email_send") {
    return { block: true, reason: "Researchers can't send emails" };
  }
});
```

---

## Quick Reference: Pi Extension APIs Used

| API | Purpose |
|-----|---------|
| `pi.registerTool()` | Register an LLM-callable tool |
| `pi.on("tool_call", ...)` | Permission gates — block or confirm |
| `pi.on("before_agent_start", ...)` | Inject role system prompt |
| `pi.on("session_start", ...)` | Start background services |
| `pi.on("session_shutdown", ...)` | Cleanup |
| `pi.registerCommand()` | Slash commands (`/daily`, `/pipeline`) |
| `pi.sendUserMessage()` | Programmatically send a message |
| `ctx.ui.confirm()` | Confirmation dialog |
| `ctx.ui.notify()` | Non-blocking notification |
| `ctx.ui.setStatus()` | Footer status indicator |
| `ctx.ui.select()` | Selection dialog |
| `pi.setActiveTools()` | Dynamically change available tools |
| `pi.exec()` | Run shell commands from extension |

---

## What We Built for Kanbun

| Component | What it does |
|-----------|-------------|
| **15 tools** | projects, contacts, drafts, email, Apollo, pipeline, GTM, follow-ups, sync, templates |
| **5 gates** | email_send (always confirm), drafts_approve (show + confirm), bulk import (threshold), Apollo (rate limit), account changes (blocked) |
| **Apollo lifecycle** | Auto-start MCP server, health check every 60s, auto-restart, graceful shutdown |
| **3 commands** | `/daily` (morning routine), `/pipeline` (status), `/drafts` (review queue) |
| **CRM system prompt** | Role definition, responsibilities, rules, daily routine, conventions |
| **3 email accounts** | 2x Gmail + 1x Outlook, with default send account per project |
