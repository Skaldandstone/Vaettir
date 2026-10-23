import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@vaettir/db";
const locks = vi.hoisted(() => ({ scope: vi.fn() }));
vi.mock("@vaettir/db", () => ({
  Prisma: { TransactionIsolationLevel: { RepeatableRead: "RepeatableRead" } },
}));
vi.mock("./caseFieldReadScope.js", () => ({
  lockCaseFieldReadScope: locks.scope,
}));
import {
  readManualRunStartReviewedAccess as access,
  readManualRunStartReviewedPreview as preview,
  admitManualStartProfileText,
  MANUAL_START_PROFILE_MAX_BYTES,
} from "./manualRunStartReviewedRead.js";
import { qualityProfileHash } from "./qualityExperienceProfile.js";
const input = {
  projectId: "project",
  originalOrganizationId: "org",
  expectedClerkActorId: "verified-subject",
  expectedNativeActorId: "native",
  requestId: "00000000-0000-4000-8000-000000000001",
};
const authorized = { clerkActorId: "verified-subject" };
function fixture() {
  const calls: string[] = [],
    native = {
      member: [{ role: "OWNER", seatType: "FULL" }],
      size: [{ bytes: 2n, kind: "object" as string | null, sqlNull: false }],
      text: [{ profileText: "{}" }],
      equality: [{ exact: true }],
    };
  locks.scope.mockReset();
  locks.scope.mockImplementation(async () => {
    calls.push("scope");
    return {
      projectId: "project",
      organizationId: "org",
      actorId: "native",
      actorClerkUserId: "verified-subject",
    };
  });
  const query = vi.fn(async (strings: TemplateStringsArray) => {
    const sql = strings.join("");
    if (sql.includes('FROM "Membership"')) {
      calls.push("member");
      return native.member;
    }
    if (sql.includes("COALESCE(octet_length")) {
      calls.push("size");
      return native.size;
    }
    if (sql.includes('AS "profileText"')) {
      calls.push("text");
      return native.text;
    }
    if (sql.includes(" AS exact")) {
      calls.push("equality");
      return native.equality;
    }
    throw Error("Unexpected synthetic SQL boundary");
  });
  const tx = { $queryRaw: query },
    transaction = vi.fn(
      async (
        work: (value: typeof tx) => Promise<unknown>,
        options: unknown,
      ) => {
        expect(options).toEqual({
          isolationLevel: "RepeatableRead",
          timeout: 20000,
          maxWait: 5000,
        });
        return work(tx);
      },
    );
  return {
    db: { $transaction: transaction } as unknown as PrismaClient,
    native,
    calls,
    query,
    transaction,
    tx,
  };
}
describe("reviewed run-start native reader source mocks, no SQL executed", () => {
  it.each([null, undefined, "", "x".repeat(201), "bad\0subject"])(
    "unsupported independently authorized subject %j refuses before any transaction",
    async (subject) => {
      const h = fixture();
      await expect(
        access(h.db, "native", input, {
          clerkActorId: subject as unknown as string,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(h.transaction).not.toHaveBeenCalled();
      expect(locks.scope).not.toHaveBeenCalled();
      expect(h.query).not.toHaveBeenCalled();
    },
  );
  it("unsupported native transport actor refuses before the read transaction, not by fallback mapping", async () => {
    const h = fixture();
    await expect(
      preview(h.db, "x".repeat(201), input, authorized),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(h.transaction).not.toHaveBeenCalled();
  });
  it("access obtains locked original scope/current native capabilities without any profile read", async () => {
    const h = fixture(),
      result = await access(h.db, "native", input, authorized);
    expect(locks.scope).toHaveBeenCalledWith(h.tx, "native", input, authorized);
    expect(h.calls).toEqual(["scope", "member"]);
    expect(result).toMatchObject({
      canConfigure: true,
      canRecover: true,
      readContext: {
        requestId: input.requestId,
        projection: "ACCESS",
        scope: { actorId: "native", actorClerkUserId: "verified-subject" },
      },
    });
    expect(result).not.toHaveProperty("profile");
    expect(result).not.toHaveProperty("canStart");
  });
  it.each(["VIEWER", "COMPLIANCE_AUDITOR", "EDITOR"])(
    "%s READ_ONLY can read metadata but cannot configure/recover/start",
    async (role) => {
      const h = fixture();
      h.native.member = [{ role, seatType: "READ_ONLY" }];
      const result = await preview(h.db, "native", input, authorized);
      expect(result).toMatchObject({
        canConfigure: false,
        canRecover: false,
        canStart: false,
        profile: { kind: "SUPPORTED", experience: null },
      });
    },
  );
  it("profile scalar admission precedes TEXT projection/hash and returns the unchanged full native JSON hash", async () => {
    const h = fixture(),
      raw = {
        retained: {
          notes: " raw\nvalue ",
          zero: 0,
          nullValue: null,
          empty: "",
        },
      };
    h.native.text = [{ profileText: JSON.stringify(raw) }];
    h.native.size[0]!.bytes = BigInt(
      Buffer.byteLength(h.native.text[0]!.profileText),
    );
    const result = await preview(h.db, "native", input, authorized);
    expect(h.calls).toEqual(["scope", "member", "size", "text", "equality"]);
    expect(result).toMatchObject({
      canStart: true,
      profile: {
        kind: "SUPPORTED",
        experience: null,
        profileHash: qualityProfileHash(raw),
      },
    });
    expect(JSON.stringify(result)).not.toContain("raw\\nvalue");
  });
  it.each(["SQL_NULL", "JSON_NULL", "array", "oversize"])(
    "%s profile refuses before body read with current recovery capability retained",
    async (kind) => {
      const h = fixture();
      if (kind === "SQL_NULL")
        h.native.size = [{ bytes: 0n, kind: null, sqlNull: true }];
      if (kind === "JSON_NULL")
        h.native.size = [{ bytes: 4n, kind: "null", sqlNull: false }];
      if (kind === "array") h.native.size[0]!.kind = "array";
      if (kind === "oversize")
        h.native.size[0]!.bytes = BigInt(MANUAL_START_PROFILE_MAX_BYTES + 1);
      const result = await preview(h.db, "native", input, authorized);
      expect(h.calls).toEqual(["scope", "member", "size"]);
      expect(result).toMatchObject({
        canRecover: true,
        canStart: false,
        profile: { kind: "UNSUPPORTED" },
      });
      expect(result.profile).not.toHaveProperty("profileHash");
    },
  );
  it("decoded numeric precision/native representation mismatch is refused, not repaired or returned with a fake hash", async () => {
    const h = fixture();
    h.native.text = [{ profileText: '{"unknown":9007199254740993}' }];
    h.native.size[0]!.bytes = BigInt(
      Buffer.byteLength(h.native.text[0]!.profileText),
    );
    h.native.equality = [{ exact: false }];
    const result = await preview(h.db, "native", input, authorized);
    expect(result).toMatchObject({
      canRecover: true,
      canStart: false,
      profile: { kind: "UNSUPPORTED" },
    });
    expect(result.profile).not.toHaveProperty("profileHash");
    expect(h.calls).toContain("equality");
  });
  it.each(["native-pin", "scope-denied"])(
    "%s rejects before native membership/profile materialization",
    async (reason) => {
      const h = fixture();
      if (reason === "scope-denied")
        locks.scope.mockRejectedValue({ code: "FORBIDDEN" });
      await expect(
        preview(
          h.db,
          "native",
          {
            ...input,
            ...(reason === "native-pin"
              ? { expectedNativeActorId: "other" }
              : {}),
          },
          authorized,
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(h.query).not.toHaveBeenCalled();
    },
  );
  it.each(["projectId", "organizationId", "actorId", "actorClerkUserId"])(
    "disagreeing locked %s cannot admit another reader's scope or profile",
    async (field) => {
      const h = fixture();
      locks.scope.mockResolvedValue({
        projectId: "project",
        organizationId: "org",
        actorId: "native",
        actorClerkUserId: "verified-subject",
        [field]: "other",
      });
      await expect(
        preview(h.db, "native", input, authorized),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(h.query).not.toHaveBeenCalled();
    },
  );
  it("native scalar/text byte disagreement fails before equality/hash without fabricating a profile", async () => {
    const h = fixture();
    h.native.text = [{ profileText: '{"retained":"different native text"}' }];
    await expect(
      preview(h.db, "native", input, authorized),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(h.calls).toEqual(["scope", "member", "size", "text"]);
  });
  it.each([
    "duplicate-member",
    "unknown-member",
    "missing-profile",
    "invalid-bytes",
    "negative-bytes",
    "duplicate-equality",
  ])(
    "%s native scalar disagreement fails closed without private errors",
    async (reason) => {
      const h = fixture();
      if (reason === "duplicate-member")
        h.native.member.push({ role: "OWNER", seatType: "FULL" });
      if (reason === "unknown-member") h.native.member[0]!.role = "future-role";
      if (reason === "missing-profile") h.native.size = [];
      if (reason === "invalid-bytes")
        h.native.size[0]!.bytes = 2 as unknown as bigint;
      if (reason === "negative-bytes") h.native.size[0]!.bytes = -1n;
      if (reason === "duplicate-equality")
        h.native.equality.push({ exact: true });
      await expect(
        preview(h.db, "native", input, authorized),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      if (reason !== "duplicate-equality")
        expect(h.calls).not.toContain("text");
    },
  );
  it("invalid or unsupported experience has no partial/default profile hash", async () => {
    const h = fixture();
    h.native.text = [
      { profileText: '{"experience":{"offerings":"not-an-array"}}' },
    ];
    h.native.size[0]!.bytes = BigInt(
      Buffer.byteLength(h.native.text[0]!.profileText),
    );
    const result = await preview(h.db, "native", input, authorized);
    expect(result).toMatchObject({
      canStart: false,
      profile: { kind: "UNSUPPORTED" },
    });
    expect(result.profile).not.toHaveProperty("profileHash");
  });
  it.each([
    "",
    "null",
    "[]",
    "{bad",
    '{"n":1e400}',
    JSON.stringify({ a: "x".repeat(MANUAL_START_PROFILE_MAX_BYTES) }),
  ])(
    "text codec refuses unsupported root/bounds/number without clipping",
    (text) => {
      expect(admitManualStartProfileText(text)).toBeNull();
    },
  );
  it("text codec bounds recursion and retains literal nested arrays/null/false/zero and reserved own keys", () => {
    const raw = JSON.parse(
      '{"__proto__":{"own":true},"constructor":"retained","n":[null,false,0,"", " raw\\nvalue "]}',
    );
    const admitted = admitManualStartProfileText(JSON.stringify(raw))!;
    expect(admitted.value).toEqual(raw);
    expect(JSON.parse(admitted.encoded)).toEqual(raw);
    let text = "0";
    for (let depth = 0; depth < 66; depth++) text = `{"nested":${text}}`;
    expect(admitManualStartProfileText(text)).toBeNull();
  });
  it("ordinary finite literal values retain exact JSON equality while a >100000-node profile is refused wholly", () => {
    expect(
      admitManualStartProfileText(
        '{"decimal":0.5,"zero":0,"empty":"","null":null}',
      )?.encoded,
    ).toBe('{"decimal":0.5,"zero":0,"empty":"","null":null}');
    expect(
      admitManualStartProfileText(
        JSON.stringify({ rows: Array(100000).fill(0) }),
      ),
    ).toBeNull();
  });
});
