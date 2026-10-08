import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@vaettir/db";
import { hardDeleteOrganization, ORG_HARD_DELETE_TRANSACTION_TIMEOUT_MS } from "./services/orgHardDelete.js";

describe("bounded organization erasure transaction", () => {
  it("uses the reviewed operation-specific limit and preserves a transaction refusal without retry", async () => {
    const refusal = new Error("Synthetic transaction refusal");
    const transaction = vi.fn().mockRejectedValue(refusal);
    const db = {
      organization: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "synthetic-org", name: "Synthetic", slug: "synthetic" }) },
      $queryRaw: vi.fn().mockResolvedValue([{ count: 0n, bytes: 2n }]),
      $transaction: transaction,
    } as unknown as PrismaClient;

    await expect(hardDeleteOrganization(db, "synthetic-org", "synthetic-actor", "Synthetic timeout contract")).rejects.toBe(refusal);
    expect(ORG_HARD_DELETE_TRANSACTION_TIMEOUT_MS).toBe(30_000);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(transaction.mock.calls[0]?.[0]).toBeTypeOf("function");
    expect(transaction.mock.calls[0]?.[1]).toEqual({ timeout: 30_000 });
  });
});
