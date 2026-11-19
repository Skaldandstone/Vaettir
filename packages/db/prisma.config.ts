import { defineConfig } from "prisma/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  schema: fileURLToPath(new URL("./prisma/schema.prisma", import.meta.url)),
  migrations: {
    path: fileURLToPath(new URL("./prisma/migrations", import.meta.url)),
    seed: "tsx prisma/seed.ts",
  },
  datasource: { url: process.env.DATABASE_URL },
});
