import { ConstraintCheckedPrismaClient } from "./constraintCheckedClient.js";
import { Prisma } from "@prisma/client";
import { createRotatingClient } from "./rotatingClient.js";

function createSharedClient() {
  const managedUrl = process.env.DB_SECRET_ID ? process.env.DATABASE_URL : undefined;
  const initial = new ConstraintCheckedPrismaClient(managedUrl ? { datasources: { db: { url: managedUrl } } } : undefined);
  // Ordinary local/test clients retain their existing native Prisma surface.
  const rotation = managedUrl
    ? createRotatingClient({
        initial,
        initialUrl: managedUrl,
        modelNames: Object.values(Prisma.ModelName).map(name => name[0]!.toLowerCase() + name.slice(1)),
        create: url => new ConstraintCheckedPrismaClient({ datasources: { db: { url } } }),
        probe: async client => {
          await client.$connect();
          await client.$queryRaw`SELECT 1`;
        },
      })
    : undefined;
  return { client: rotation?.client ?? initial, rotation };
}

declare global {
   
  var __vaettirDatabase: ReturnType<typeof createSharedClient> | undefined;
}

const shared = globalThis.__vaettirDatabase ?? createSharedClient();
export const prisma = shared.client;

export async function refreshDatabaseCredentials(url: string) {
  if (!shared.rotation) throw new Error("Managed database refresh is not configured");
  await shared.rotation.refresh(url);
  process.env.DATABASE_URL = url;
}

export function databasePoolStatus() {
  return shared.rotation?.status() ?? { refreshing: false, draining: 0, cleanupFailed: false };
}

if (process.env.NODE_ENV !== "production") {
  globalThis.__vaettirDatabase = shared;
}

export * from "@prisma/client";
