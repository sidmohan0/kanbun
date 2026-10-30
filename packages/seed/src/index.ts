/**
 * Deterministic seed data. Same seed → same workspace, byte for byte, so
 * tests and perf runs are reproducible. Writes go through the real mutators
 * wherever one exists (so counters, subscriptions and the log are real) and
 * straight to the store for phase-2 entities that have no mutators yet.
 */
import { uuidv7, type Row } from "@kanbun/model";
import { DEFAULT_STATES, mutators } from "@kanbun/mutators";
import type { Actor } from "@kanbun/sync";
import { SyncServer, SYSTEM_TAG } from "@kanbun/sync/server";

export type SeedOptions = {
  seed?: number;
  issues?: number;
  projects?: number;
  cycles?: number;
  users?: number;
  commentsPerIssue?: number;
  /** Epoch ms for "now"; defaults to a fixed date so output is stable. */
  now?: number;
};

export type SeedResult = {
  ownerId: string;
  userIds: string[];
  teamIds: string[];
  issueIds: string[];
  projectIds: string[];
  counts: Record<string, number>;
  ms: number;
};

/** Mulberry32: small, fast, deterministic. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = [
  "Ada",
  "Grace",
  "Linus",
  "Margaret",
  "Dennis",
  "Barbara",
  "Ken",
  "Radia",
  "Tim",
  "Frances",
  "Guido",
  "Anita",
  "Bjarne",
  "Hedy",
  "Donald",
  "Mary",
];
const LAST = [
  "Lovelace",
  "Hopper",
  "Torvalds",
  "Hamilton",
  "Ritchie",
  "Liskov",
  "Thompson",
  "Perlman",
  "Berners-Lee",
  "Allen",
  "van Rossum",
  "Borg",
  "Stroustrup",
  "Lamarr",
  "Knuth",
  "Shaw",
];
const VERBS = ["Fix", "Add", "Remove", "Refactor", "Investigate", "Document", "Migrate", "Optimize", "Design", "Ship"];
const OBJECTS = [
  "PII detector",
  "regex engine",
  "S3 connector",
  "Slack intake",
  "redaction API",
  "batch scanner",
  "audit log",
  "billing webhook",
  "onboarding flow",
  "CLI",
  "dashboard",
  "OCR pipeline",
  "entity resolver",
  "rate limiter",
  "export job",
];
const TAILS = [
  "for enterprise tenants",
  "on large files",
  "in the EU region",
  "when the token expires",
  "under load",
  "for the mobile client",
  "before GA",
  "with retries",
  "for the demo",
  "",
];
const LABELS: [string, string][] = [
  ["Bug", "#EB5757"],
  ["Feature", "#5E6AD2"],
  ["Improvement", "#4CB782"],
  ["Tech debt", "#F2994A"],
  ["Security", "#BB6BD9"],
  ["Docs", "#26B5CE"],
  ["Customer request", "#F2C94C"],
];
const PROJECT_NAMES = [
  "Redaction v2",
  "Enterprise SSO",
  "EU data residency",
  "Streaming scanner",
  "Self-serve billing",
  "Python SDK 1.0",
  "Slack app",
  "Audit log export",
  "OCR for scanned PDFs",
  "Entity graph",
  "Usage dashboard",
  "Zero-downtime migrations",
];
const STATUS_TYPES = [
  "backlog",
  "planned",
  "started",
  "started",
  "started",
  "paused",
  "completed",
  "canceled",
] as const;

export function seedWorkspace(server: SyncServer, opts: SeedOptions = {}): SeedResult {
  const t0 = performance.now();
  const rand = rng(opts.seed ?? 42);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
  const chance = (p: number) => rand() < p;
  const nUsers = opts.users ?? 12;
  const nIssues = opts.issues ?? 5000;
  const nProjects = opts.projects ?? 40;
  const nCycles = opts.cycles ?? 6;
  const baseNow = opts.now ?? Date.UTC(2026, 9, 29, 12, 0, 0);
  let clock = baseNow - 180 * 86_400_000; // start six months back
  const tick = () => new Date((clock += 1000 + Math.floor(rand() * 60_000))).toISOString();
  const counts: Record<string, number> = {};
  const bump = (k: string, n = 1) => (counts[k] = (counts[k] ?? 0) + n);

  // Fixed-time server clock so timestamps are deterministic.
  const serverNow = () => new Date(clock).toISOString();
  (server as unknown as { now: () => string }).now = serverNow;

  // --- users --------------------------------------------------------------------------------
  const ownerId = "user-owner";
  server.system("workspaceInit", {
    organization: { id: uuidv7(baseNow), name: "DataFog", urlKey: "datafog" },
    owner: { id: ownerId, name: "Sid Mohan", email: "sid@datafog.ai" },
  });
  const userIds = [ownerId];
  for (let i = 0; i < nUsers - 1; i++) {
    const id = `user-${i + 1}`;
    const name = `${FIRST[i % FIRST.length]} ${LAST[(i * 7) % LAST.length]}`;
    server.system("memberSync", {
      id,
      name,
      email: `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@datafog.ai`,
      role: i === 0 ? "admin" : "user",
    });
    userIds.push(id);
  }
  bump("user", userIds.length);

  // Mutations are queued per user and flushed in batches of 200 (one transaction each).
  const as = (userId: string): Actor => ({ id: userId, type: "user" });
  const mids = new Map<string, number>();
  const queues = new Map<string, { id: number; name: string; args: unknown; ts: string }[]>();
  const flush = (userId?: string) => {
    for (const [uid, q] of queues) {
      if (userId && uid !== userId) continue;
      if (!q.length) continue;
      const res = server.push(as(uid), { clientId: `seed-${uid}`, mutations: q.splice(0, q.length) });
      if (!res.ok) throw new Error(`seed push failed: ${res.error}`);
      if (res.rejected.length) throw new Error(`seed rejected: ${res.rejected[0]!.error}`);
    }
  };
  const push = (userId: string, name: string, args: unknown) => {
    const id = (mids.get(userId) ?? 0) + 1;
    mids.set(userId, id);
    let q = queues.get(userId);
    if (!q) queues.set(userId, (q = []));
    q.push({ id, name, args, ts: tick() });
    if (q.length >= 200) flush(userId);
  };

  // --- teams ----------------------------------------------------------------------------------
  const teams: { id: string; key: string; states: Record<string, string>; members: string[] }[] = [];
  const teamSpecs = [
    { name: "DataFog", key: "DF", triage: true, cycles: true },
    { name: "Platform", key: "PLT", triage: false, cycles: true },
    { name: "Growth", key: "GRO", triage: false, cycles: false },
  ];
  for (const spec of teamSpecs) {
    const id = uuidv7(clock);
    const states: Record<string, string> = {};
    for (const s of DEFAULT_STATES) if (s.key !== "triage" || spec.triage) states[s.key] = uuidv7(clock);
    push(ownerId, "teamCreate", { id, name: spec.name, key: spec.key, stateIds: states, membershipId: uuidv7(clock) });
    push(ownerId, "teamUpdate", {
      id,
      patch: {
        triageEnabled: spec.triage,
        cyclesEnabled: spec.cycles,
        cycleDuration: 2,
        issueEstimationType: "fibonacci",
      },
    });
    const members = userIds.filter((u) => u === ownerId || chance(0.6));
    for (const u of members)
      if (u !== ownerId) push(ownerId, "teamMembershipCreate", { id: uuidv7(clock), teamId: id, userId: u });
    teams.push({ id, key: spec.key, states, members });
  }
  flush();
  bump("team", teams.length);

  // --- labels -----------------------------------------------------------------------------------
  const labelIds: string[] = [];
  for (const [name, color] of LABELS) {
    const id = uuidv7(clock);
    push(ownerId, "issueLabelCreate", { id, name, color });
    labelIds.push(id);
  }
  const areaGroup = uuidv7(clock);
  push(ownerId, "issueLabelCreate", {
    id: areaGroup,
    name: "Area",
    color: "#95A2B3",
    isGroup: true,
    groupType: "single",
  });
  const areaIds: string[] = [];
  for (const area of ["API", "Web", "Infra", "SDK"]) {
    const id = uuidv7(clock);
    push(ownerId, "issueLabelCreate", { id, name: area, color: "#95A2B3", parentId: areaGroup });
    areaIds.push(id);
  }
  flush();
  bump("issueLabel", labelIds.length + areaIds.length + 1);

  // --- project statuses, projects, milestones, cycles (phase-2 entities: direct puts) -------------
  const store = server.store.withTag(SYSTEM_TAG("seed"));
  const statusIds: Record<string, string> = {};
  const statusDefs: [string, string, string][] = [
    ["Backlog", "backlog", "#95A2B3"],
    ["Planned", "planned", "#5E6AD2"],
    ["In Progress", "started", "#F2C94C"],
    ["Paused", "paused", "#F2994A"],
    ["Completed", "completed", "#4CB782"],
    ["Canceled", "canceled", "#95A2B3"],
  ];
  statusDefs.forEach(([name, type, color], i) => {
    const id = uuidv7(clock);
    statusIds[type] = id;
    store.insert("projectStatus", {
      id,
      name,
      type,
      color,
      position: i,
      teamId: null,
      createdAt: tick(),
      updatedAt: tick(),
    } as Row<"projectStatus">);
  });
  const projects: { id: string; milestoneIds: string[]; teamId: string }[] = [];
  for (let i = 0; i < nProjects; i++) {
    const id = uuidv7(clock);
    const type = pick(STATUS_TYPES);
    const team = pick(teams);
    const created = tick();
    store.insert("project", {
      id,
      name: `${PROJECT_NAMES[i % PROJECT_NAMES.length]}${i >= PROJECT_NAMES.length ? ` ${Math.floor(i / PROJECT_NAMES.length) + 1}` : ""}`,
      slugId: id.slice(-8),
      description: `Project ${i + 1} seeded for ${team.key}.`,
      color: pick(["#5E6AD2", "#26B5CE", "#4CB782", "#F2C94C", "#F2994A", "#EB5757", "#BB6BD9"]),
      statusId: statusIds[type]!,
      priority: Math.floor(rand() * 5),
      prioritySortOrder: `a${String(i).padStart(4, "0")}`,
      sortOrder: `a${String(i).padStart(4, "0")}`,
      leadId: pick(team.members),
      leadTeamId: team.id,
      creatorId: ownerId,
      startDate: chance(0.7) ? created.slice(0, 10) : null,
      targetDate: chance(0.7) ? new Date(clock + 30 * 86_400_000 * (1 + rand() * 4)).toISOString().slice(0, 10) : null,
      startedAt: type === "started" || type === "completed" ? created : null,
      completedAt: type === "completed" ? tick() : null,
      canceledAt: type === "canceled" ? tick() : null,
      health: type === "started" ? pick(["onTrack", "onTrack", "atRisk", "offTrack"]) : null,
      createdAt: created,
      updatedAt: created,
    } as Row<"project">);
    store.insert("projectTeam", {
      id: uuidv7(clock),
      projectId: id,
      teamId: team.id,
      createdAt: created,
      updatedAt: created,
    } as Row<"projectTeam">);
    const milestoneIds: string[] = [];
    const nMs = Math.floor(rand() * 4);
    for (let m = 0; m < nMs; m++) {
      const mid = uuidv7(clock);
      store.insert("projectMilestone", {
        id: mid,
        projectId: id,
        name: `Milestone ${m + 1}`,
        sortOrder: `a${m}`,
        targetDate: null,
        status: "unstarted",
        createdAt: created,
        updatedAt: created,
      } as Row<"projectMilestone">);
      milestoneIds.push(mid);
    }
    projects.push({ id, milestoneIds, teamId: team.id });
  }
  bump("project", projects.length);

  const cyclesByTeam = new Map<string, string[]>();
  for (const team of teams.filter((t) => t.key !== "GRO")) {
    const ids: string[] = [];
    for (let c = 0; c < nCycles; c++) {
      const id = uuidv7(clock);
      const starts = baseNow - (nCycles - 2 - c) * 14 * 86_400_000;
      store.insert("cycle", {
        id,
        teamId: team.id,
        number: c + 1,
        name: null,
        startsAt: new Date(starts).toISOString(),
        endsAt: new Date(starts + 14 * 86_400_000).toISOString(),
        completedAt: starts + 14 * 86_400_000 < baseNow ? new Date(starts + 14 * 86_400_000).toISOString() : null,
        createdAt: tick(),
        updatedAt: tick(),
      } as Row<"cycle">);
      ids.push(id);
    }
    cyclesByTeam.set(team.id, ids);
  }
  bump("cycle", [...cyclesByTeam.values()].flat().length);

  // --- issues ---------------------------------------------------------------------------------------
  const issueIds: string[] = [];
  const perTeam = new Map<string, string[]>();
  for (let i = 0; i < nIssues; i++) {
    const team = pick(teams);
    const creator = pick(team.members);
    const id = uuidv7(clock);
    const stateKey = pick([
      "backlog",
      "backlog",
      "todo",
      "todo",
      "inProgress",
      "done",
      "done",
      "done",
      "canceled",
    ] as const);
    const stateId = team.states[stateKey] ?? team.states["backlog"]!;
    const project = chance(0.6) ? pick(projects.filter((p) => p.teamId === team.id)) : undefined;
    const labels = [
      ...new Set([
        ...(chance(0.7) ? [pick(labelIds)] : []),
        ...(chance(0.3) ? [pick(labelIds)] : []),
        ...(chance(0.5) ? [pick(areaIds)] : []),
      ]),
    ];
    const siblings = perTeam.get(team.id) ?? [];
    const parentId = siblings.length > 20 && chance(0.15) ? pick(siblings) : undefined;
    if (parentId) flush();
    const cycles = cyclesByTeam.get(team.id);
    push(creator, "issueCreate", {
      id,
      teamId: team.id,
      title: `${pick(VERBS)} ${pick(OBJECTS)} ${pick(TAILS)}`.trim(),
      description: chance(0.6)
        ? `Seeded description for issue ${i + 1}. Steps to reproduce, expected and actual behaviour go here.`
        : null,
      stateId,
      priority: pick([0, 0, 1, 2, 2, 3, 3, 4]),
      estimate: chance(0.4) ? pick([1, 2, 3, 5, 8]) : null,
      dueDate: chance(0.15) ? new Date(clock + 86_400_000 * (1 + rand() * 30)).toISOString().slice(0, 10) : null,
      assigneeId: chance(0.7) ? pick(team.members) : null,
      assigneeSubscriptionId: uuidv7(clock),
      parentId: parentId ?? null,
      projectId: project?.id ?? null,
      projectMilestoneId: project && project.milestoneIds.length && chance(0.5) ? pick(project.milestoneIds) : null,
      cycleId: cycles && stateKey !== "backlog" && chance(0.6) ? pick(cycles) : null,
      labelIds: labels,
      labelLinkIds: labels.map(() => uuidv7(clock)),
      subscriptionId: uuidv7(clock),
    });
    issueIds.push(id);
    siblings.push(id);
    perTeam.set(team.id, siblings);
    const nComments = Math.min(opts.commentsPerIssue ?? 2, Math.floor(rand() * 4));
    if (nComments > 0) flush();
    for (let c = 0; c < nComments; c++) {
      push(pick(team.members), "commentCreate", {
        id: uuidv7(clock),
        issueId: id,
        body: pick([
          "Looking into this.",
          "Repro confirmed on staging.",
          "Blocked on the SDK release.",
          "Fixed in the latest build, please verify.",
          "Moving to next cycle.",
        ]),
        subscriptionId: uuidv7(clock),
      });
      bump("comment");
    }
  }
  flush();
  bump("issue", issueIds.length);

  return {
    ownerId,
    userIds,
    teamIds: teams.map((t) => t.id),
    issueIds,
    projectIds: projects.map((p) => p.id),
    counts,
    ms: performance.now() - t0,
  };
}

export { mutators };
