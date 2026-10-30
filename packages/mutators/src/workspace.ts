import type { Row } from "@kanbun/model";
import { MutationError, defineMutator, type MutatorContext } from "@kanbun/sync";
import { z } from "zod";
import { actorRef, id, iso, nullable } from "./schema";

const AVATAR_COLORS = ["#5E6AD2", "#26B5CE", "#4CB782", "#F2C94C", "#F2994A", "#EB5757", "#BB6BD9", "#2F80ED"];

const role = z.enum(["owner", "admin", "user", "guest"]);

export const memberSyncArgs = z.object({
  id: actorRef,
  name: z.string().min(1),
  email: z.string().email(),
  role: role.optional(),
  active: z.boolean().optional(),
  directoryAdmissionId: nullable(id).optional(),
  notificationEventFloor: z.number().int().nonnegative().optional(),
  archivedAt: nullable(iso).optional(),
  avatarUrl: nullable(z.string().url()).optional(),
  timezone: nullable(z.string()).optional(),
});

/**
 * Mirrors one workspace member from D1 into the DO. System actor only; the
 * Worker calls it whenever membership or profile changes.
 */
function memberSyncRun(ctx: MutatorContext, args: z.infer<typeof memberSyncArgs>): void {
  if (ctx.actor.type !== "system") throw new MutationError("memberSync is system-only", "forbidden");
  const existing = ctx.store.get("user", args.id);
  const initials = args.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
  if (existing) {
    if (args.directoryAdmissionId && args.directoryAdmissionId !== existing.directoryAdmissionId) {
      for (const membership of ctx.store.list("teamMembership", { userId: args.id }))
        ctx.store.delete("teamMembership", membership.id);
      for (const row of ctx.store.list("notification", { userId: args.id })) ctx.store.delete("notification", row.id);
      for (const row of ctx.store.list("notificationSubscription", { subscriberId: args.id }))
        ctx.store.delete("notificationSubscription", row.id);
    }
    ctx.store.patch("user", args.id, {
      name: args.name,
      displayName: existing.displayName || args.name,
      email: args.email,
      initials,
      role: args.role ?? existing.role,
      active: args.active ?? existing.active,
      archivedAt: args.archivedAt === undefined ? existing.archivedAt : args.archivedAt,
      directoryAdmissionId:
        args.directoryAdmissionId === undefined ? existing.directoryAdmissionId : args.directoryAdmissionId,
      notificationEventFloor: args.notificationEventFloor ?? existing.notificationEventFloor,
      avatarUrl: args.avatarUrl === undefined ? existing.avatarUrl : args.avatarUrl,
      timezone: args.timezone === undefined ? existing.timezone : args.timezone,
      updatedAt: ctx.now,
    });
    return;
  }
  const hash = [...args.id].reduce((a, c) => a + c.charCodeAt(0), 0);
  ctx.store.insert("user", {
    id: args.id,
    name: args.name,
    displayName: args.name,
    email: args.email,
    avatarUrl: args.avatarUrl ?? null,
    avatarBackgroundColor: AVATAR_COLORS[hash % AVATAR_COLORS.length]!,
    initials,
    role: args.role ?? "user",
    guest: args.role === "guest",
    active: args.active ?? true,
    directoryAdmissionId: args.directoryAdmissionId ?? null,
    notificationEventFloor: args.notificationEventFloor ?? 0,
    timezone: args.timezone ?? null,
    createdAt: ctx.now,
    updatedAt: ctx.now,
  } as Row<"user">);
  ctx.store.insert("userSettings", {
    id: `settings-${args.id}`,
    userId: args.id,
    createdAt: ctx.now,
    updatedAt: ctx.now,
  } as Row<"userSettings">);
}

export const workspaceInitArgs = z.object({
  organization: z.object({ id, name: z.string().min(1), urlKey: z.string().regex(/^[a-z0-9-]{2,32}$/) }),
  owner: memberSyncArgs.omit({ role: true }),
});

export const mutators = {
  workspaceNameSync: defineMutator({
    args: z.object({ id, name: z.string().trim().min(1) }),
    description: "Mirror the directory's authoritative workspace name. System actor only.",
    run(ctx, args) {
      if (ctx.actor.type !== "system") throw new MutationError("workspaceNameSync is system-only", "forbidden");
      const organization = ctx.store.get("organization", args.id);
      if (!organization) throw new MutationError("workspace not found", "not_found");
      if (organization.name !== args.name)
        ctx.store.patch("organization", args.id, { name: args.name, updatedAt: ctx.now });
    },
  }),
  workspaceInit: defineMutator({
    args: workspaceInitArgs,
    description: "Create the organization row and its owner. System actor, runs once.",
    run(ctx, args) {
      if (ctx.actor.type !== "system") throw new MutationError("workspaceInit is system-only", "forbidden");
      if (ctx.store.list("organization").length > 0)
        throw new MutationError("workspace already initialised", "conflict");
      ctx.store.insert("organization", {
        id: args.organization.id,
        name: args.organization.name,
        urlKey: args.organization.urlKey,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      } as Row<"organization">);
      memberSyncRun(ctx, { ...args.owner, role: "owner" });
    },
  }),

  memberSync: defineMutator({
    args: memberSyncArgs,
    description: "Mirror a workspace member from the accounts database. System actor only.",
    run: memberSyncRun,
  }),

  userUpdate: defineMutator({
    args: z.object({
      id: actorRef,
      patch: z
        .object({
          displayName: z.string().min(1),
          description: nullable(z.string()),
          statusEmoji: nullable(z.string()),
          statusLabel: nullable(z.string()),
          statusUntilAt: nullable(iso),
          timezone: nullable(z.string()),
        })
        .partial(),
    }),
    description: "Edit a member's profile fields that live in the workspace (display name, status).",
    run(ctx, args) {
      const me = ctx.store.get("user", ctx.actorId);
      if (args.id !== ctx.actorId && me?.role !== "admin" && me?.role !== "owner") {
        throw new MutationError("only admins can edit other users", "forbidden");
      }
      ctx.store.patch("user", args.id, { ...args.patch, updatedAt: ctx.now });
    },
  }),

  userSettingsUpdate: defineMutator({
    args: z.object({
      patch: z
        .object({
          notificationCategoryPreferences: z.record(
            z.string(),
            z.object({ desktop: z.boolean(), email: z.boolean(), mobile: z.boolean() }),
          ),
          notificationChannelPreferences: z.object({ desktop: z.boolean(), email: z.boolean(), mobile: z.boolean() }),
          autoAssignToSelf: z.boolean(),
          sidebar: z.record(z.string(), z.unknown()),
        })
        .partial(),
    }),
    description: "Update the caller's per-workspace settings (notifications, sidebar).",
    run(ctx, args) {
      const row = ctx.store.list("userSettings", { userId: ctx.actorId })[0];
      if (!row) throw new MutationError("no settings row", "not_found");
      ctx.store.patch("userSettings", row.id, { ...args.patch, updatedAt: ctx.now } as Partial<Row<"userSettings">>);
    },
  }),

  agentCreate: defineMutator({
    args: z.object({
      id,
      name: z.string().min(1).max(80),
      description: nullable(z.string()).optional(),
      mode: z.enum(["propose", "commit"]).optional(),
      scopes: z.object({ teamIds: z.array(id), projectIds: z.array(id), mutators: z.array(z.string()) }).optional(),
      rateBudget: z.number().int().min(1).max(100_000).optional(),
    }),
    description: "Register an agent owned by the caller. Its API key is issued separately by the Worker.",
    run(ctx, args) {
      if (ctx.actor.type !== "user") throw new MutationError("only users can create agents", "forbidden");
      ctx.store.insert("agent", {
        id: args.id,
        name: args.name,
        description: args.description ?? null,
        ownerId: ctx.actorId,
        mode: args.mode ?? "propose",
        scopes: args.scopes ?? { teamIds: [], projectIds: [], mutators: [] },
        rateBudget: args.rateBudget ?? 600,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      } as Row<"agent">);
    },
  }),

  agentUpdate: defineMutator({
    args: z.object({
      id,
      patch: z
        .object({
          name: z.string().min(1).max(80),
          description: nullable(z.string()),
          mode: z.enum(["propose", "commit"]),
          scopes: z.object({ teamIds: z.array(id), projectIds: z.array(id), mutators: z.array(z.string()) }),
          rateBudget: z.number().int().min(1).max(100_000),
          active: z.boolean(),
        })
        .partial(),
    }),
    description: "Change an agent's mode, scopes, budget or active flag. Owner or admin only.",
    run(ctx, args) {
      const a = ctx.store.get("agent", args.id);
      if (!a) throw new MutationError("agent not found", "not_found");
      const me = ctx.store.get("user", ctx.actorId);
      if (a.ownerId !== ctx.actorId && me?.role !== "admin" && me?.role !== "owner")
        throw new MutationError("not your agent", "forbidden");
      ctx.store.patch("agent", args.id, { ...args.patch, updatedAt: ctx.now });
    },
  }),
};
