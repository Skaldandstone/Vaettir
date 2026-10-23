import { PrismaClient, type Prisma } from "@prisma/client";

type TransactionOptions = {
  maxWait?: number;
  timeout?: number;
  isolationLevel?: Prisma.TransactionIsolationLevel;
};
type Results<P extends Prisma.PrismaPromise<unknown>[]> = {
  [K in keyof P]: Awaited<P[K]>;
};

/** Surface deferred PostgreSQL failures before Prisma acknowledges a commit.
 * Prisma 5.22's native engine can resolve COMMIT after PostgreSQL rolls back on
 * a deferred constraint error. Validate the identical final transaction state
 * as its last statement, while query errors still propagate to the caller.
 * No constraints are disabled, no state is committed early, and batch result
 * ordering and interactive options remain unchanged. Prisma stores DateTime in
 * UTC timestamp-without-time-zone columns; transaction-local UTC also prevents
 * raw driver timestamptz parameters from shifting those boundaries.
 */
export class ConstraintCheckedPrismaClient extends PrismaClient {
  override $transaction<P extends Prisma.PrismaPromise<unknown>[]>(
    operations: [...P],
    options?: { isolationLevel?: Prisma.TransactionIsolationLevel },
  ): Promise<Results<P>>;
  override $transaction<R>(
    work: (tx: Prisma.TransactionClient) => Promise<R>,
    options?: TransactionOptions,
  ): Promise<R>;
  override async $transaction(
    work:
      | Prisma.PrismaPromise<unknown>[]
      | ((tx: Prisma.TransactionClient) => Promise<unknown>),
    options?: TransactionOptions,
  ): Promise<unknown> {
    if (typeof work === "function") {
      return super.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL TIME ZONE 'UTC'`;
        const result = await work(tx);
        await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
        return result;
      }, options);
    }
    const results = await super.$transaction(
      [
        this.$executeRaw`SET LOCAL TIME ZONE 'UTC'`,
        ...work,
        this.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`,
      ],
      options,
    );
    return results.slice(1, -1);
  }
}
