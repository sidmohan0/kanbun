import type { DashboardView, AgentDetail } from "@/types";

const now = new Date().toISOString();
const hourAgo = new Date(Date.now() - 3600000).toISOString();
const threeHoursAgo = new Date(Date.now() - 10800000).toISOString();

export const mockDashboard: DashboardView = {
  stats: {
    total_agents: 15,
    running: 3,
    idle: 9,
    errored: 1,
    needs_attention: 3,
    files_changed_today: 47,
  },
  needs_attention: [
    {
      agent_id: "a1",
      agent_name: "DF Python SDK",
      project_name: "DataFog",
      reason: "errored",
      timestamp: hourAgo,
    },
    {
      agent_id: "a2",
      agent_name: "TF Marketing & Outbound",
      project_name: "ThreadFork",
      reason: "needs_review",
      timestamp: threeHoursAgo,
    },
    {
      agent_id: "a3",
      agent_name: "AI Consulting Outbound",
      project_name: "Consulting",
      reason: "blocked",
      timestamp: hourAgo,
    },
  ],
  projects: [
    {
      project: { id: "p1", name: "ThreadFork", color: "#6366f1", repo_paths: [], created_at: now },
      agents: [
        {
          agent: { id: "tf1", name: "TF Landing Page", project_id: "p1", kind: "terminal", function_tag: "landing_page", status: "running", working_directory: "~/code/threadfork-site", last_active_at: now, created_at: now, config: { autonomy_level: "supervised", watch_paths: [], schedule: null, notify_on: ["errored"] } },
          recent_run: { id: "r1", agent_id: "tf1", status: "in_progress", started_at: hourAgo, ended_at: null, summary: "Updating hero section copy and CTA", outputs: [], file_changes: [{ path: "src/app/page.tsx", change_type: "modified", timestamp: now }, { path: "src/components/Hero.tsx", change_type: "modified", timestamp: now }] },
          files_changed_today: 8,
        },
        {
          agent: { id: "tf2", name: "TF Marketing & Outbound", project_id: "p1", kind: "script", function_tag: "marketing", status: "completed", working_directory: null, last_active_at: threeHoursAgo, created_at: now, config: { autonomy_level: "draft_only", watch_paths: [], schedule: "0 9 * * 1-5", notify_on: ["errored", "completed"] } },
          recent_run: { id: "r2", agent_id: "tf2", status: "needs_review", started_at: threeHoursAgo, ended_at: hourAgo, summary: "Drafted 8 cold emails targeting privacy consultants", outputs: [{ kind: "email_draft", content: "Subject: Private transcription for your practice...", timestamp: hourAgo }], file_changes: [] },
          files_changed_today: 0,
        },
        {
          agent: { id: "tf3", name: "TF Core App", project_id: "p1", kind: "terminal", function_tag: "engineering", status: "running", working_directory: "~/code/threadfork", last_active_at: now, created_at: now, config: { autonomy_level: "supervised", watch_paths: [], schedule: null, notify_on: ["errored"] } },
          recent_run: { id: "r3", agent_id: "tf3", status: "in_progress", started_at: hourAgo, ended_at: null, summary: "Implementing GLiNER2 integration for fact-grounded summaries", outputs: [], file_changes: [{ path: "src-tauri/src/summarizer.rs", change_type: "modified", timestamp: now }] },
          files_changed_today: 14,
        },
        {
          agent: { id: "tf4", name: "TF Speech Pipeline", project_id: "p1", kind: "terminal", function_tag: "engineering", status: "idle", working_directory: "~/code/threadfork", last_active_at: threeHoursAgo, created_at: now, config: { autonomy_level: "supervised", watch_paths: [], schedule: null, notify_on: ["errored"] } },
          recent_run: { id: "r4", agent_id: "tf4", status: "completed", started_at: threeHoursAgo, ended_at: hourAgo, summary: "Fixed speaker diarization edge case with overlapping speech", outputs: [], file_changes: [] },
          files_changed_today: 3,
        },
        {
          agent: { id: "tf5", name: "TF MCP Integrations", project_id: "p1", kind: "terminal", function_tag: "engineering", status: "idle", working_directory: "~/code/threadfork-mcp", last_active_at: threeHoursAgo, created_at: now, config: { autonomy_level: "manual", watch_paths: [], schedule: null, notify_on: ["errored"] } },
          recent_run: null,
          files_changed_today: 0,
        },
      ],
    },
    {
      project: { id: "p2", name: "DataFog", color: "#10b981", repo_paths: [], created_at: now },
      agents: [
        {
          agent: { id: "df1", name: "DF Python SDK", project_id: "p2", kind: "terminal", function_tag: "sdk", status: "errored", working_directory: "~/code/datafog-python", last_active_at: hourAgo, created_at: now, config: { autonomy_level: "supervised", watch_paths: [], schedule: null, notify_on: ["errored"] } },
          recent_run: { id: "r5", agent_id: "df1", status: "failed", started_at: hourAgo, ended_at: hourAgo, summary: "CI failed: test_pii_detection_batch assertion error on line 142", outputs: [{ kind: "error", content: "AssertionError: Expected 5 PII entities, got 3", timestamp: hourAgo }], file_changes: [{ path: "tests/test_batch.py", change_type: "modified", timestamp: hourAgo }] },
          files_changed_today: 6,
        },
        {
          agent: { id: "df2", name: "DF Docs & Content", project_id: "p2", kind: "script", function_tag: "marketing", status: "idle", working_directory: null, last_active_at: threeHoursAgo, created_at: now, config: { autonomy_level: "draft_only", watch_paths: [], schedule: "0 8 * * 1", notify_on: ["completed"] } },
          recent_run: { id: "r6", agent_id: "df2", status: "completed", started_at: threeHoursAgo, ended_at: threeHoursAgo, summary: "Generated changelog entry for v0.4.2 release", outputs: [], file_changes: [] },
          files_changed_today: 0,
        },
        {
          agent: { id: "df3", name: "DF Landing Page", project_id: "p2", kind: "terminal", function_tag: "landing_page", status: "idle", working_directory: "~/code/datafog-site", last_active_at: threeHoursAgo, created_at: now, config: { autonomy_level: "supervised", watch_paths: [], schedule: null, notify_on: ["errored"] } },
          recent_run: null,
          files_changed_today: 0,
        },
      ],
    },
    {
      project: { id: "p3", name: "Personal", color: "#f59e0b", repo_paths: [], created_at: now },
      agents: [
        {
          agent: { id: "pe1", name: "Golf Improvement Tracker", project_id: "p3", kind: "script", function_tag: "personal", status: "idle", working_directory: null, last_active_at: threeHoursAgo, created_at: now, config: { autonomy_level: "autonomous", watch_paths: [], schedule: "0 7 * * *", notify_on: [] } },
          recent_run: { id: "r7", agent_id: "pe1", status: "completed", started_at: threeHoursAgo, ended_at: threeHoursAgo, summary: "Logged putting drill results, grip pressure notes", outputs: [], file_changes: [] },
          files_changed_today: 0,
        },
        {
          agent: { id: "pe2", name: "Morning Routine Ops", project_id: "p3", kind: "script", function_tag: "personal", status: "completed", working_directory: null, last_active_at: threeHoursAgo, created_at: now, config: { autonomy_level: "autonomous", watch_paths: [], schedule: "0 6 * * *", notify_on: [] } },
          recent_run: null,
          files_changed_today: 0,
        },
        {
          agent: { id: "pe3", name: "Research & Learning", project_id: "p3", kind: "api", function_tag: "research", status: "running", working_directory: null, last_active_at: now, created_at: now, config: { autonomy_level: "supervised", watch_paths: [], schedule: null, notify_on: ["completed"] } },
          recent_run: { id: "r8", agent_id: "pe3", status: "in_progress", started_at: hourAgo, ended_at: null, summary: "Researching computational storage trends for consulting deck", outputs: [], file_changes: [] },
          files_changed_today: 0,
        },
      ],
    },
    {
      project: { id: "p4", name: "Consulting", color: "#ec4899", repo_paths: [], created_at: now },
      agents: [
        {
          agent: { id: "co1", name: "AI Consulting Outbound", project_id: "p4", kind: "script", function_tag: "marketing", status: "blocked", working_directory: null, last_active_at: hourAgo, created_at: now, config: { autonomy_level: "draft_only", watch_paths: [], schedule: "0 10 * * 1-5", notify_on: ["blocked", "errored"] } },
          recent_run: { id: "r9", agent_id: "co1", status: "needs_review", started_at: hourAgo, ended_at: hourAgo, summary: "Blocked: need updated target company list for Series A-C outreach", outputs: [], file_changes: [] },
          files_changed_today: 0,
        },
        {
          agent: { id: "co2", name: "Proposal Generator", project_id: "p4", kind: "api", function_tag: "sales", status: "idle", working_directory: null, last_active_at: threeHoursAgo, created_at: now, config: { autonomy_level: "draft_only", watch_paths: [], schedule: null, notify_on: ["completed"] } },
          recent_run: null,
          files_changed_today: 0,
        },
        {
          agent: { id: "co3", name: "Client Research", project_id: "p4", kind: "api", function_tag: "research", status: "idle", working_directory: null, last_active_at: threeHoursAgo, created_at: now, config: { autonomy_level: "supervised", watch_paths: [], schedule: null, notify_on: [] } },
          recent_run: null,
          files_changed_today: 0,
        },
        {
          agent: { id: "co4", name: "Deliverable Builder", project_id: "p4", kind: "terminal", function_tag: "engineering", status: "idle", working_directory: "~/code/consulting-templates", last_active_at: threeHoursAgo, created_at: now, config: { autonomy_level: "supervised", watch_paths: [], schedule: null, notify_on: ["errored"] } },
          recent_run: null,
          files_changed_today: 0,
        },
      ],
    },
  ],
};
