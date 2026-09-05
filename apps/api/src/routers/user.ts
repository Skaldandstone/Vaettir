import { z } from "zod";
import { router, protectedProcedure } from "../trpc.js";

// P8-04: registration for the current signed-in user's own devices, not
// scoped to any org/project - a push token belongs to a person, not a
// membership. upsert on `token` (not userId) since re-registering the same
// physical device (app relaunch, token refresh) should update in place,
// not pile up duplicate rows.
export const userRouter = router({
  registerPushToken: protectedProcedure
    .input(z.object({ token: z.string().min(1), platform: z.enum(["ios", "android"]).optional() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.pushToken.upsert({
        where: { token: input.token },
        create: { userId: ctx.user.id, token: input.token, platform: input.platform },
        update: { userId: ctx.user.id, platform: input.platform },
      });
    }),

  clearPushToken: protectedProcedure
    .input(z.object({ token: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.pushToken.deleteMany({ where: { token: input.token, userId: ctx.user.id } });
    }),
});
