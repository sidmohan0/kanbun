import { MutationError, defineMutator, notificationVisible } from "@kanbun/sync";
import { z } from "zod";
import { id } from "./schema";

export const mutators = {
  notificationRead: defineMutator({
    args: z.object({ id, read: z.boolean() }),
    description: "Mark your own currently visible notification read or unread.",
    run(ctx, args) {
      const row = ctx.store.get("notification", args.id);
      const teams = ctx.store
        .list("team")
        .filter(
          (team) =>
            !team.archivedAt &&
            (team.visibility === "public" ||
              ctx.store
                .list("teamMembership", { teamId: team.id, userId: ctx.actorId })
                .some((membership) => !membership.archivedAt)),
        )
        .map((team) => team.id);
      if (ctx.actor.type !== "user" || !row || !notificationVisible(ctx.store, ctx.actorId, teams, row))
        throw new MutationError("Notification is unavailable", "not_found");
      if (Boolean(row.readAt) !== args.read)
        ctx.store.patch("notification", row.id, { readAt: args.read ? ctx.now : null, updatedAt: ctx.now });
    },
  }),
};
