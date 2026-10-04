import { ConstraintCheckedPrismaClient } from "./constraintCheckedClient.js";

declare global {
   
  var __vaettirPrisma: ConstraintCheckedPrismaClient | undefined;
}

export const prisma = globalThis.__vaettirPrisma ?? new ConstraintCheckedPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__vaettirPrisma = prisma;
}

export * from "@prisma/client";
