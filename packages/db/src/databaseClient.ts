import { PrismaClient as GeneratedPrismaClient, type Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

type ClientOptions = Omit<Prisma.PrismaClientOptions, "adapter"> & {
  adapter?: Prisma.PrismaClientOptions["adapter"];
  datasources?: { db?: { url?: string } };
};

export class PrismaClient extends GeneratedPrismaClient {
  constructor(options?: ClientOptions) {
    const { datasources, ...clientOptions } = options ?? {};
    const connectionString = datasources?.db?.url ?? process.env.DATABASE_URL;
    const url = connectionString ? new URL(connectionString) : undefined;
    const connectionLimit = url?.searchParams.get("connection_limit");
    const connectTimeout = url?.searchParams.get("connect_timeout") ?? "5";
    const tlsServerName = process.env.VAETTIR_DATABASE_TLS_HOST;
    const tunneledTls = tlsServerName && url?.hostname === "127.0.0.1";
    if (tunneledTls) url.searchParams.delete("sslmode");
    const adapter = clientOptions.adapter ?? new PrismaPg({
      connectionString: tunneledTls ? url.toString() : connectionString,
      ...(tunneledTls ? { ssl: { servername: tlsServerName, rejectUnauthorized: true } } : {}),
      ...(connectionLimit ? { max: Number(connectionLimit) } : {}),
      connectionTimeoutMillis: Number(connectTimeout) * 1000,
    }, { schema: url?.searchParams.get("schema") ?? "public" });
    super({ ...clientOptions, adapter });
  }
}
