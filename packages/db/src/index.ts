import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __qiPrisma: PrismaClient | undefined;
}

export const prisma = globalThis.__qiPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__qiPrisma = prisma;
}

export * from "@prisma/client";
