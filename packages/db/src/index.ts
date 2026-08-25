import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __vaettirPrisma: PrismaClient | undefined;
}

export const prisma = globalThis.__vaettirPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__vaettirPrisma = prisma;
}

export * from "@prisma/client";
