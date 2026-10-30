import { viewPreferencesValues, type Row } from "@kanbun/model";
import { MutationError, defineMutator } from "@kanbun/sync";
import { z } from "zod";
import { keyAfter } from "./ordering";
import { color, id, nullable } from "./schema";

export const mutators = {
  viewPreferencesSet: defineMutator({
    args: z.object({
      /** id to use if a row must be created. */
      id,
      viewType: z.string().min(1),
      type: z.enum(["user", "organization"]).optional(),
      customViewId: nullable(id).optional(),
      teamId: nullable(id).optional(),
      projectId: nullable(id).optional(),
      cycleId: nullable(id).optional(),
      preferences: viewPreferencesValues,
    }),
    description: "Merge display preferences (layout, grouping, ordering, visible fields) for one view.",
    run(ctx, args) {
      const type = args.type ?? "user";
      const where = {
        type,
        userId: type === "user" ? ctx.actorId : null,
        viewType: args.viewType,
        customViewId: args.customViewId ?? null,
        teamId: args.teamId ?? null,
        projectId: args.projectId ?? null,
        cycleId: args.cycleId ?? null,
      };
      const existing = ctx.store.list("viewPreferences", where)[0];
      if (existing)
        ctx.store.patch("viewPreferences", existing.id, {
          preferences: { ...existing.preferences, ...args.preferences },
          updatedAt: ctx.now,
        });
      else
        ctx.store.insert("viewPreferences", {
          id: args.id,
          ...where,
          preferences: args.preferences,
          createdAt: ctx.now,
          updatedAt: ctx.now,
        } as Row<"viewPreferences">);
    },
  }),

  customViewCreate: defineMutator({
    args: z.object({
      id,
      name: z.string().min(1).max(80),
      slugId: z.string().min(4).max(16),
      description: nullable(z.string()).optional(),
      icon: nullable(z.string()).optional(),
      color: nullable(color).optional(),
      modelName: z.enum(["issue", "project", "initiative", "customer"]).optional(),
      filterData: z.record(z.string(), z.unknown()).optional(),
      shared: z.boolean().optional(),
      teamId: nullable(id).optional(),
    }),
    description: "Save a filtered view of issues (or projects, initiatives, customers).",
    run(ctx, args) {
      ctx.store.insert("customView", {
        id: args.id,
        name: args.name.trim(),
        slugId: args.slugId,
        description: args.description ?? null,
        icon: args.icon ?? null,
        color: args.color ?? null,
        modelName: args.modelName ?? "issue",
        filterData: args.filterData ?? {},
        shared: args.shared ?? false,
        teamId: args.teamId ?? null,
        ownerId: ctx.actorId,
        creatorId: ctx.actorId,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      } as Row<"customView">);
    },
  }),

  customViewUpdate: defineMutator({
    args: z.object({
      id,
      patch: z
        .object({
          name: z.string().min(1).max(80),
          description: nullable(z.string()),
          icon: nullable(z.string()),
          color: nullable(color),
          filterData: z.record(z.string(), z.unknown()),
          shared: z.boolean(),
          teamId: nullable(id),
          ownerId: z.string().min(1),
        })
        .partial(),
    }),
    description: "Edit a saved view's name, filters or sharing.",
    run(ctx, args) {
      const v = ctx.store.get("customView", args.id);
      if (!v) throw new MutationError("view not found", "not_found");
      if (v.ownerId !== ctx.actorId && !v.shared) throw new MutationError("not your view", "forbidden");
      ctx.store.patch("customView", args.id, { ...args.patch, updatedById: ctx.actorId, updatedAt: ctx.now });
    },
  }),

  customViewDelete: defineMutator({
    args: z.object({ id }),
    description: "Delete a saved view (owner or admin).",
    run(ctx, args) {
      const v = ctx.store.get("customView", args.id);
      if (!v) return;
      const me = ctx.store.get("user", ctx.actorId);
      if (v.ownerId !== ctx.actorId && me?.role !== "admin" && me?.role !== "owner")
        throw new MutationError("not your view", "forbidden");
      for (const f of ctx.store.list("favorite", { customViewId: args.id })) ctx.store.delete("favorite", f.id);
      ctx.store.patch("customView", args.id, { archivedAt: ctx.now, updatedAt: ctx.now });
    },
  }),

  favoriteCreate: defineMutator({
    args: z.object({
      id,
      type: z.string().min(1),
      title: z.string().min(1).max(120),
      target: z
        .object({
          issueId: id,
          projectId: id,
          documentId: id,
          customViewId: id,
          cycleId: id,
          labelId: id,
          initiativeId: id,
          customerId: id,
          teamId: id,
          predefinedViewType: z.string(),
          predefinedViewTeamId: id,
        })
        .partial(),
      parentId: nullable(id).optional(),
    }),
    description: "Add an item to the caller's sidebar favorites.",
    run(ctx, args) {
      const mine = ctx.store.list("favorite", { ownerId: ctx.actorId });
      ctx.store.insert("favorite", {
        id: args.id,
        ownerId: ctx.actorId,
        type: args.type,
        title: args.title,
        parentId: args.parentId ?? null,
        sortOrder: keyAfter(mine.map((f) => f.sortOrder)),
        ...args.target,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      } as Row<"favorite">);
    },
  }),

  favoriteUpdate: defineMutator({
    args: z.object({
      id,
      patch: z
        .object({
          title: z.string().min(1).max(120),
          sortOrder: z.string().min(1),
          parentId: nullable(id),
          folderName: nullable(z.string()),
        })
        .partial(),
    }),
    description: "Rename, reorder or move a favorite into a folder.",
    run(ctx, args) {
      const f = ctx.store.get("favorite", args.id);
      if (!f || f.ownerId !== ctx.actorId) throw new MutationError("favorite not found", "not_found");
      ctx.store.patch("favorite", args.id, { ...args.patch, updatedAt: ctx.now });
    },
  }),

  favoriteDelete: defineMutator({
    args: z.object({ id }),
    description: "Remove a favorite.",
    run(ctx, args) {
      const f = ctx.store.get("favorite", args.id);
      if (!f || f.ownerId !== ctx.actorId) return;
      ctx.store.delete("favorite", args.id);
    },
  }),

  draftSave: defineMutator({
    args: z.object({
      id,
      kind: z.enum(["issue", "comment", "projectUpdate", "initiativeUpdate", "document"]),
      teamId: nullable(id).optional(),
      issueId: nullable(id).optional(),
      parentCommentId: nullable(id).optional(),
      projectId: nullable(id).optional(),
      initiativeId: nullable(id).optional(),
      documentId: nullable(id).optional(),
      data: z.record(z.string(), z.unknown()),
    }),
    description: "Create or update one of the caller's drafts (an unsent issue, comment or update).",
    run(ctx, args) {
      const existing = ctx.store.get("draft", args.id);
      if (existing) {
        if (existing.userId !== ctx.actorId) throw new MutationError("not your draft", "forbidden");
        ctx.store.patch("draft", args.id, { data: args.data, updatedAt: ctx.now });
        return;
      }
      ctx.store.insert("draft", {
        id: args.id,
        userId: ctx.actorId,
        kind: args.kind,
        teamId: args.teamId ?? null,
        issueId: args.issueId ?? null,
        parentCommentId: args.parentCommentId ?? null,
        projectId: args.projectId ?? null,
        initiativeId: args.initiativeId ?? null,
        documentId: args.documentId ?? null,
        data: args.data,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      } as Row<"draft">);
    },
  }),

  draftDelete: defineMutator({
    args: z.object({ id }),
    description: "Discard a draft.",
    run(ctx, args) {
      const d = ctx.store.get("draft", args.id);
      if (!d || d.userId !== ctx.actorId) return;
      ctx.store.delete("draft", args.id);
    },
  }),
};
