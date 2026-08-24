import { initTRPC } from "@trpc/server";
import { prisma } from "@tci/db";

export function createContext() {
  return { prisma };
}

export type Context = ReturnType<typeof createContext>;

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;
