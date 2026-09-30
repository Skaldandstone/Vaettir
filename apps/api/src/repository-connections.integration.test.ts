import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, type OrgRole, type SeatType } from "@vaettir/db";
import { repositoryConnectionsRouter } from "./routers/repositoryConnections.js";
import { hashOAuthState, listGitlabRepositories, verifyGitlabAuthorization } from "./services/gitlabRepositoryOAuth.js";
import { listGithubRepositories, revokeGithubAuthorization, verifyGithubAuthorization } from "./services/githubRepositoryOAuth.js";
import { decryptToken, type EncryptedToken } from "./services/tokenEncryption.js";

vi.mock("./services/gitlabRepositoryOAuth.js", async importOriginal => ({
  ...await importOriginal<typeof import("./services/gitlabRepositoryOAuth.js")>(),
  verifyGitlabAuthorization: vi.fn(),
  listGitlabRepositories: vi.fn(),
}));
vi.mock("./services/githubRepositoryOAuth.js", async importOriginal => ({
  ...await importOriginal<typeof import("./services/githubRepositoryOAuth.js")>(),
  verifyGithubAuthorization: vi.fn(),
  listGithubRepositories: vi.fn(),
  revokeGithubAuthorization: vi.fn(),
}));

const databaseUrl = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
const isolated = databaseUrl && ["localhost", "127.0.0.1"].includes(databaseUrl.hostname)
  && /test/i.test(databaseUrl.pathname) && !databaseUrl.searchParams.has("host");
const origin = "https://gitlab.synthetic.example";
const clientSecret = "synthetic-client-secret-not-live";
const accessToken = "synthetic-access-token-not-live";
const repositories = [{ id: "101", name: "synthetic/service", url: `${origin}/synthetic/service`, defaultBranch: "main" }];

describe.skipIf(!isolated)("repository authorization and reviewed selection", () => {
  let projectId: string;
  let organizationId: string;
  let configurationId: string;
  let ownerId: string;
  let owner: ReturnType<typeof repositoryConnectionsRouter.createCaller>;
  let editor: typeof owner;
  let viewer: typeof owner;
  let readOnlyAdmin: typeof owner;
  let outsider: typeof owner;

  async function actor(role?: OrgRole, seatType: SeatType = "FULL") {
    const key = randomUUID();
    const user = await prisma.user.create({
      data: { email: `${key}@example.com`, clerkUserId: key,
        ...(role ? { memberships: { create: { organizationId, role, seatType } } } : {}) },
      include: { memberships: true },
    });
    return { user, caller: repositoryConnectionsRouter.createCaller({ prisma, user,
      staff: null, securityLogger: undefined, staffAttempt: { tokenConfigured: false, tokenPresented: false, actorHeaderPresented: false } }) };
  }

  async function begin() {
    const result = await owner.begin({ projectId, configurationId, approveMetadataAccess: true });
    return { ...result, state: new URL(result.url).searchParams.get("state")! };
  }

  async function verified() {
    const pending = await begin();
    await owner.finish({ state: pending.state, code: "synthetic-code" });
    return pending;
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubEnv("WEB_APP_URL", "https://vaettir.synthetic.example");
    vi.stubEnv("PRODUCTION_SIGNAL_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
    const key = `repository-${randomUUID()}`;
    const tier = await prisma.planTier.findUniqueOrThrow({ where: { key: "free" } });
    const org = await prisma.organization.create({ data: { name: key, slug: key, planTierId: tier.id } });
    organizationId = org.id;
    projectId = (await prisma.project.create({ data: { organizationId, name: key, slug: key } })).id;
    const own = await actor("OWNER"); owner = own.caller; ownerId = own.user.id;
    editor = (await actor("EDITOR")).caller;
    viewer = (await actor("VIEWER")).caller;
    readOnlyAdmin = (await actor("ADMIN", "READ_ONLY")).caller;
    outsider = (await actor()).caller;
    configurationId = (await owner.configureGitlab({ projectId, origin, clientId: "synthetic-client", clientSecret })).id;
    vi.mocked(verifyGitlabAuthorization).mockResolvedValue({ token: accessToken, expiresAt: new Date(Date.now() + 3600000), accountLabel: "synthetic-user" });
    vi.mocked(listGitlabRepositories).mockResolvedValue(repositories);
    vi.mocked(verifyGithubAuthorization).mockResolvedValue({ token: accessToken, expiresAt: new Date(Date.now() + 3600000), accountLabel: "github-fixture" });
    vi.mocked(listGithubRepositories).mockResolvedValue([{ id: "202", name: "team/hosted", url: "https://github.com/team/hosted", defaultBranch: "main" }]);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("keeps configuration secrets encrypted and out of customer responses", async () => {
    const response = await owner.configurations({ projectId });
    expect(response).toMatchObject({ storageReady: true, canConfigure: true, configurations: [{ id: configurationId, provider: "gitlab", origin }] });
    expect(JSON.stringify(response)).not.toContain(clientSecret);
    expect(response.configurations[0]).not.toHaveProperty("encryptedSecret");
    const stored = await prisma.repositoryProviderConfiguration.findUniqueOrThrow({ where: { id: configurationId } });
    expect(JSON.stringify(stored.encryptedSecret)).not.toContain(clientSecret);
    expect(decryptToken(stored.encryptedSecret as unknown as EncryptedToken)).toBe(clientSecret);
    await expect(owner.configureGitlab({ projectId, origin, clientId: "replacement", clientSecret: "replacement-secret" })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("configures hosted GitHub once and keeps its client secret encrypted", async () => {
    const saved = await owner.configureGithub({ projectId, clientId: "github-app-fixture", clientSecret });
    expect(saved).toMatchObject({ provider: "github", origin: "https://github.com" });
    const stored = await prisma.repositoryProviderConfiguration.findUniqueOrThrow({ where: { id: saved.id } });
    expect(JSON.stringify(stored.encryptedSecret)).not.toContain(clientSecret);
    expect(decryptToken(stored.encryptedSecret as unknown as EncryptedToken)).toBe(clientSecret);
    await expect(owner.configureGithub({ projectId, clientId: "another", clientSecret })).rejects.toMatchObject({ code: "CONFLICT" });
    for (const caller of [editor, viewer, readOnlyAdmin, outsider])
      await expect(caller.configureGithub({ projectId, clientId: "another", clientSecret })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("binds GitHub authorization to the actor, verifies once and saves only reviewed repositories", async () => {
    const config = await owner.configureGithub({ projectId, clientId: "github-app-fixture", clientSecret });
    const pending = await owner.begin({ projectId, configurationId: config.id, approveMetadataAccess: true });
    const url = new URL(pending.url);
    const state = url.searchParams.get("state")!;
    const stored = await prisma.repositoryConnection.findUniqueOrThrow({ where: { id: pending.id } });
    expect(stored).toMatchObject({ provider: "github", origin: "https://github.com", stateHash: hashOAuthState(state) });
    expect(url.searchParams.get("code_challenge")).toBe(createHash("sha256").update(decryptToken(stored.encryptedVerifier as unknown as EncryptedToken)).digest("base64url"));
    await expect(editor.finish({ state, code: "synthetic-code" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await owner.finish({ state, code: "synthetic-code" });
    await expect(owner.finish({ state, code: "synthetic-code" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(verifyGithubAuthorization).toHaveBeenCalledTimes(1);
    expect(await owner.status({ id: pending.id })).toMatchObject({ status: "VERIFIED", accountLabel: "github-fixture" });
    const listed = await owner.list({ id: pending.id });
    expect(listed.repositories).toEqual([{ id: "202", name: "team/hosted", url: "https://github.com/team/hosted", defaultBranch: "main" }]);
    await expect(owner.connectSelected({ id: pending.id, repositoryIds: ["missing"], catalogVersion: listed.catalogVersion, approved: true })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await prisma.projectRepository.count({ where: { projectId } })).toBe(0);
    await owner.connectSelected({ id: pending.id, repositoryIds: ["202", "202"], catalogVersion: listed.catalogVersion, approved: true });
    await owner.connectSelected({ id: pending.id, repositoryIds: ["202"], catalogVersion: listed.catalogVersion, approved: true });
    expect(await prisma.projectRepository.findMany({ where: { projectId } })).toEqual([expect.objectContaining({ provider: "github", externalId: "202", connectionId: pending.id })]);
  });

  it("filters only the current GitHub page and cannot approve a hidden repository ID", async () => {
    const config = await owner.configureGithub({ projectId, clientId: "github-app-fixture", clientSecret });
    const pending = await owner.begin({ projectId, configurationId: config.id, approveMetadataAccess: true });
    await owner.finish({ state: new URL(pending.url).searchParams.get("state")!, code: "synthetic-code" });
    vi.mocked(listGithubRepositories).mockResolvedValueOnce([
      { id: "202", name: "team/hosted", url: "https://github.com/team/hosted", defaultBranch: "main" },
      { id: "203", name: "team/hidden", url: "https://github.com/team/hidden", defaultBranch: "main" },
    ]);
    const listing = await owner.list({ id: pending.id, page: 2, search: "hosted" });
    expect(listGithubRepositories).toHaveBeenCalledWith(accessToken, 2);
    expect(listing.repositories.map(repo => repo.id)).toEqual(["202"]);
    await expect(owner.connectSelected({ id: pending.id, repositoryIds: ["203"], catalogVersion: listing.catalogVersion, approved: true })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await prisma.projectRepository.count({ where: { projectId } })).toBe(0);
  });

  it("revokes a GitHub token before clearing the local connection and repository link", async () => {
    const config = await owner.configureGithub({ projectId, clientId: "github-app-fixture", clientSecret });
    const pending = await owner.begin({ projectId, configurationId: config.id, approveMetadataAccess: true });
    await owner.finish({ state: new URL(pending.url).searchParams.get("state")!, code: "synthetic-code" });
    const listing = await owner.list({ id: pending.id });
    await owner.connectSelected({ id: pending.id, repositoryIds: ["202"], catalogVersion: listing.catalogVersion, approved: true });
    await expect(owner.disconnect({ id: pending.id })).resolves.toEqual({ disconnected: true });
    expect(revokeGithubAuthorization).toHaveBeenCalledOnce();
    expect(revokeGithubAuthorization).toHaveBeenCalledWith({ clientId: "github-app-fixture", clientSecret, token: accessToken });
    expect(await prisma.repositoryConnection.findUniqueOrThrow({ where: { id: pending.id } })).toMatchObject({ status: "DISCONNECTED", encryptedToken: null });
    expect(await prisma.projectRepository.findFirstOrThrow({ where: { projectId } })).toMatchObject({ connectionId: null, verifiedAt: null });
  });

  it("preserves the GitHub connection and repository link when upstream revocation fails", async () => {
    const config = await owner.configureGithub({ projectId, clientId: "github-app-fixture", clientSecret });
    const pending = await owner.begin({ projectId, configurationId: config.id, approveMetadataAccess: true });
    await owner.finish({ state: new URL(pending.url).searchParams.get("state")!, code: "synthetic-code" });
    const listing = await owner.list({ id: pending.id });
    await owner.connectSelected({ id: pending.id, repositoryIds: ["202"], catalogVersion: listing.catalogVersion, approved: true });
    const before = await prisma.repositoryConnection.findUniqueOrThrow({ where: { id: pending.id } });
    const link = await prisma.projectRepository.findFirstOrThrow({ where: { projectId } });
    vi.mocked(revokeGithubAuthorization).mockRejectedValueOnce(new Error("provider unavailable"));
    await expect(owner.disconnect({ id: pending.id })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(await prisma.repositoryConnection.findUniqueOrThrow({ where: { id: pending.id } })).toEqual(before);
    expect(await prisma.projectRepository.findUniqueOrThrow({ where: { id: link.id } })).toEqual(link);
  });

  it("enforces tenant, role, full seat, and explicit metadata approval", async () => {
    await expect(outsider.configurations({ projectId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    for (const caller of [editor, viewer, readOnlyAdmin]) {
      await expect(caller.configureGitlab({ projectId, origin: "https://another.synthetic.example", clientId: "id", clientSecret })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    for (const caller of [viewer, readOnlyAdmin, outsider]) {
      await expect(caller.begin({ projectId, configurationId, approveMetadataAccess: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await expect(owner.begin({ projectId, configurationId, approveMetadataAccess: false as true })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const anotherOrg = await prisma.organization.create({ data: { name: "Other synthetic tenant", slug: randomUUID(), planTierId: (await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } })).planTierId } });
    const foreign = await prisma.repositoryProviderConfiguration.create({ data: { organizationId: anotherOrg.id, provider: "gitlab", origin, clientId: "foreign", encryptedSecret: {}, createdById: ownerId } });
    await expect(owner.begin({ projectId, configurationId: foreign.id, approveMetadataAccess: true })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(verifyGitlabAuthorization).not.toHaveBeenCalled();
  });

  it("binds real unpredictable state and PKCE to the initiating actor", async () => {
    const pending = await begin();
    const second = await begin();
    expect(second.state).not.toBe(pending.state);
    const row = await prisma.repositoryConnection.findUniqueOrThrow({ where: { id: pending.id } });
    expect(row.stateHash).toBe(hashOAuthState(pending.state));
    const verifier = decryptToken(row.encryptedVerifier as unknown as EncryptedToken);
    expect(new URL(pending.url).searchParams.get("code_challenge")).toBe(createHash("sha256").update(verifier).digest("base64url"));
    expect(new URL(pending.url).searchParams.get("code_challenge_method")).toBe("S256");
    await expect(editor.finish({ state: pending.state, code: "synthetic-code" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(editor.status({ id: pending.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(owner.finish({ state: "x".repeat(43), code: "synthetic-code" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(verifyGitlabAuthorization).not.toHaveBeenCalled();
  });

  it("consumes denied authorization without exchange and rejects replay", async () => {
    const pending = await begin();
    await expect(owner.finish({ state: pending.state, denied: true })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await owner.status({ id: pending.id })).toMatchObject({ status: "CANCELED" });
    await expect(owner.finish({ state: pending.state, code: "synthetic-code" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(verifyGitlabAuthorization).not.toHaveBeenCalled();
  });

  it("refuses expired authorization before provider exchange", async () => {
    const pending = await begin();
    await prisma.repositoryConnection.update({ where: { id: pending.id }, data: { authorizationExpiresAt: new Date(Date.now() - 1000) } });
    await expect(owner.finish({ state: pending.state, code: "synthetic-code" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(verifyGitlabAuthorization).not.toHaveBeenCalled();
  });

  it("verifies once, removes the verifier, and never exposes provider credentials", async () => {
    const pending = await verified();
    expect(verifyGitlabAuthorization).toHaveBeenCalledTimes(1);
    await expect(owner.finish({ state: pending.state, code: "synthetic-code" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const stored = await prisma.repositoryConnection.findUniqueOrThrow({ where: { id: pending.id } });
    expect(stored.encryptedVerifier).toBeNull();
    expect(decryptToken(stored.encryptedToken as unknown as EncryptedToken)).toBe(accessToken);
    const status = await owner.status({ id: pending.id });
    expect(status).toMatchObject({ status: "VERIFIED", accountLabel: "synthetic-user" });
    expect(JSON.stringify(status)).not.toContain(accessToken);
    expect(status).not.toHaveProperty("encryptedToken");
  });

  it("does not retain provider tokens when membership is revoked during verification", async () => {
    const pending = await begin();
    vi.mocked(verifyGitlabAuthorization).mockImplementationOnce(async () => {
      await prisma.membership.delete({ where: { organizationId_userId: { organizationId, userId: ownerId } } });
      return { token: accessToken, expiresAt: new Date(Date.now() + 3600000), accountLabel: "synthetic-user" };
    });
    await expect(owner.finish({ state: pending.state, code: "synthetic-code" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await prisma.repositoryConnection.findUniqueOrThrow({ where: { id: pending.id } })).toMatchObject({ status: "FAILED", encryptedToken: null });
  });

  it("requires verified, current listing evidence and rejects unknown repository IDs", async () => {
    const pending = await begin();
    await expect(owner.list({ id: pending.id })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(listGitlabRepositories).not.toHaveBeenCalled();
    await owner.finish({ state: pending.state, code: "synthetic-code" });
    await expect(owner.connectSelected({ id: pending.id, repositoryIds: ["101"], catalogVersion: "0".repeat(64), approved: true })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const listing = await owner.list({ id: pending.id });
    expect(listing).toMatchObject({ repositories, hasMore: false, catalogVersion: expect.any(String) });
    const { catalogVersion } = listing;
    await expect(owner.connectSelected({ id: pending.id, repositoryIds: ["unlisted"], catalogVersion, approved: true })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(owner.connectSelected({ id: pending.id, repositoryIds: ["101"], catalogVersion, approved: false as true })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await prisma.projectRepository.count({ where: { projectId } })).toBe(0);
    await prisma.repositoryConnection.update({ where: { id: pending.id }, data: { catalogAt: new Date(Date.now() - 660000) } });
    await expect(owner.connectSelected({ id: pending.id, repositoryIds: ["101"], catalogVersion, approved: true })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("connects identical selections idempotently while preserving a human-pinned revision", async () => {
    const pending = await verified();
    const { catalogVersion } = await owner.list({ id: pending.id });
    const manual = await prisma.projectRepository.create({ data: { projectId, provider: "gitlab", url: repositories[0]!.url, revision: "human-pinned-release-sha" } });
    const input = { id: pending.id, repositoryIds: ["101", "101"], catalogVersion, approved: true as const };
    expect(await owner.connectSelected(input)).toEqual({ connected: 1 });
    expect(await owner.connectSelected(input)).toEqual({ connected: 1 });
    expect(await prisma.projectRepository.findMany({ where: { projectId } })).toEqual([
      expect.objectContaining({ id: manual.id, revision: "human-pinned-release-sha", externalId: "101", connectionId: pending.id }),
    ]);
  });

  it("rechecks membership at selection commit even when the request context is stale", async () => {
    const pending = await verified();
    const { catalogVersion } = await owner.list({ id: pending.id });
    await prisma.membership.update({ where: { organizationId_userId: { organizationId, userId: ownerId } }, data: { role: "VIEWER" } });
    await expect(owner.connectSelected({ id: pending.id, repositoryIds: ["101"], catalogVersion, approved: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await prisma.projectRepository.count({ where: { projectId } })).toBe(0);
  });

  it("does not publish authorization completed after organization suspension", async () => {
    const pending = await begin();
    vi.mocked(verifyGitlabAuthorization).mockImplementationOnce(async () => {
      await prisma.organization.update({ where: { id: organizationId }, data: { suspendedAt: new Date() } });
      return { token: accessToken, expiresAt: new Date(Date.now() + 3600000), accountLabel: "synthetic-user" };
    });
    await expect(owner.finish({ state: pending.state, code: "synthetic-code" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const stored = await prisma.repositoryConnection.findUniqueOrThrow({ where: { id: pending.id } });
    expect(stored.status).not.toBe("VERIFIED");
    expect(stored.encryptedToken).toBeNull();
  });

  it.each(["revoked", "suspended"] as const)("does not publish a delayed repository list after access is %s", async change => {
    const pending = await verified();
    vi.mocked(listGitlabRepositories).mockImplementationOnce(async () => {
      if (change === "revoked") await prisma.membership.delete({ where: { organizationId_userId: { organizationId, userId: ownerId } } });
      else await prisma.organization.update({ where: { id: organizationId }, data: { suspendedAt: new Date() } });
      return repositories;
    });
    await expect(owner.list({ id: pending.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const stored = await prisma.repositoryConnection.findUniqueOrThrow({ where: { id: pending.id } });
    expect(stored.catalog).toBeNull();
    expect(stored.catalogAt).toBeNull();
  });

  it("reports expired tokens truthfully and refuses a new list or selection", async () => {
    const pending = await verified();
    const { catalogVersion } = await owner.list({ id: pending.id });
    await prisma.repositoryConnection.update({ where: { id: pending.id }, data: { tokenExpiresAt: new Date(Date.now() - 1000) } });
    expect(await owner.status({ id: pending.id })).toMatchObject({ status: "EXPIRED" });
    const calls = vi.mocked(listGitlabRepositories).mock.calls.length;
    await expect(owner.list({ id: pending.id })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(owner.connectSelected({ id: pending.id, repositoryIds: ["101"], catalogVersion, approved: true })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(listGitlabRepositories).toHaveBeenCalledTimes(calls);
  });

  it("disconnect wins against a delayed authorization response", async () => {
    const pending = await begin();
    vi.mocked(verifyGitlabAuthorization).mockImplementationOnce(async () => {
      await owner.disconnect({ id: pending.id });
      return { token: accessToken, expiresAt: new Date(Date.now() + 3600000), accountLabel: "synthetic-user" };
    });
    await expect(owner.finish({ state: pending.state, code: "synthetic-code" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const stored = await prisma.repositoryConnection.findUniqueOrThrow({ where: { id: pending.id } });
    expect(stored).toMatchObject({ status: "DISCONNECTED", encryptedToken: null, encryptedVerifier: null, catalog: null });
  });

  it("disconnect wins against a delayed repository list without deleting registered evidence", async () => {
    const pending = await verified();
    const { catalogVersion } = await owner.list({ id: pending.id });
    await owner.connectSelected({ id: pending.id, repositoryIds: ["101"], catalogVersion, approved: true });
    const before = await prisma.projectRepository.findFirstOrThrow({ where: { projectId } });
    vi.mocked(listGitlabRepositories).mockImplementationOnce(async () => {
      await owner.disconnect({ id: pending.id });
      return repositories;
    });
    await expect(owner.list({ id: pending.id })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const stored = await prisma.repositoryConnection.findUniqueOrThrow({ where: { id: pending.id } });
    expect(stored).toMatchObject({ status: "DISCONNECTED", encryptedToken: null, catalog: null });
    expect(await prisma.projectRepository.findUniqueOrThrow({ where: { id: before.id } })).toMatchObject({ id: before.id, url: before.url, revision: before.revision });
  });

  it("rejects a stale catalog snapshot even when the selected ID still exists", async () => {
    const pending = await verified();
    const first = await owner.list({ id: pending.id });
    vi.mocked(listGitlabRepositories).mockResolvedValueOnce([{ ...repositories[0]!, name: "synthetic/renamed-service", url: `${origin}/synthetic/renamed-service` }]);
    const second = await owner.list({ id: pending.id });
    expect(second.catalogVersion).not.toBe(first.catalogVersion);
    await expect(owner.connectSelected({ id: pending.id, repositoryIds: ["101"], catalogVersion: first.catalogVersion, approved: true })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await prisma.projectRepository.count({ where: { projectId } })).toBe(0);
    expect(await owner.connectSelected({ id: pending.id, repositoryIds: ["101"], catalogVersion: second.catalogVersion, approved: true })).toEqual({ connected: 1 });
  });

  it("keeps reviewed selections across verified pages and expires the accumulated catalog", async () => {
    const pending = await verified();
    const firstPage = Array.from({ length: 100 }, (_, index) => ({ id: String(101 + index),
      name: `synthetic/repository-${index}`, url: `${origin}/synthetic/repository-${index}`, defaultBranch: "main" }));
    const later = { id: "201", name: "synthetic/repository-100", url: `${origin}/synthetic/repository-100`, defaultBranch: "main" };
    vi.mocked(listGitlabRepositories).mockResolvedValueOnce(firstPage).mockResolvedValueOnce([later]);
    const first = await owner.list({ id: pending.id, page: 1 });
    expect(first).toMatchObject({ hasMore: true, catalogReset: true });
    const second = await owner.list({ id: pending.id, page: 2 });
    expect(second).toMatchObject({ hasMore: false, catalogReset: false });
    expect(second.catalogVersion).not.toBe(first.catalogVersion);
    await expect(owner.connectSelected({ id: pending.id, repositoryIds: ["101", "201"],
      catalogVersion: first.catalogVersion, approved: true })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await owner.connectSelected({ id: pending.id, repositoryIds: ["101", "201"],
      catalogVersion: second.catalogVersion, approved: true })).toEqual({ connected: 2 });
    expect(await prisma.projectRepository.count({ where: { projectId } })).toBe(2);
    await prisma.repositoryConnection.update({ where: { id: pending.id }, data: { catalogAt: new Date(Date.now() - 660_000) } });
    const renewed = await owner.list({ id: pending.id, page: 1 });
    expect(renewed.catalogReset).toBe(true);
    await expect(owner.connectSelected({ id: pending.id, repositoryIds: ["201"],
      catalogVersion: renewed.catalogVersion, approved: true })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("removes app credentials and connections only for an admin, retaining repository references", async () => {
    const pending = await verified();
    const listing = await owner.list({ id: pending.id });
    await owner.connectSelected({ id: pending.id, repositoryIds: ["101"], catalogVersion: listing.catalogVersion, approved: true });
    const before = await prisma.projectRepository.findFirstOrThrow({ where: { projectId } });
    await expect(editor.removeConfiguration({ projectId, configurationId, confirmed: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await owner.removeConfiguration({ projectId, configurationId, confirmed: true });
    expect(await prisma.repositoryProviderConfiguration.findUnique({ where: { id: configurationId } })).toBeNull();
    expect(await prisma.repositoryConnection.findUnique({ where: { id: pending.id } })).toBeNull();
    expect(await prisma.projectRepository.findUniqueOrThrow({ where: { id: before.id } })).toMatchObject({ id: before.id, url: before.url, connectionId: null, verifiedAt: null });
  });

  it("config removal during verification cannot restore a credential", async () => {
    const pending = await begin();
    vi.mocked(verifyGitlabAuthorization).mockImplementationOnce(async () => {
      await owner.removeConfiguration({ projectId, configurationId, confirmed: true });
      return { token: accessToken, expiresAt: new Date(Date.now()+3600000), accountLabel: "synthetic-user" };
    });
    await expect(owner.finish({ state: pending.state, code: "synthetic-code" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await prisma.repositoryConnection.findUnique({ where: { id: pending.id } })).toBeNull();
  });

  it("does not silently take over another actor's existing repository connection", async () => {
    const first = await verified();
    const firstList = await owner.list({ id: first.id });
    await owner.connectSelected({ id: first.id, repositoryIds: ["101"], catalogVersion: firstList.catalogVersion, approved: true });
    const original = await prisma.projectRepository.findFirstOrThrow({ where: { projectId } });
    const second = await editor.begin({ projectId, configurationId, approveMetadataAccess: true });
    await editor.finish({ state: new URL(second.url).searchParams.get("state")!, code: "synthetic-editor-code" });
    const secondList = await editor.list({ id: second.id });
    await expect(editor.connectSelected({ id: second.id, repositoryIds: ["101"], catalogVersion: secondList.catalogVersion, approved: true })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await prisma.projectRepository.findUniqueOrThrow({ where: { id: original.id } })).toEqual(original);
    await expect(editor.disconnect({ id: first.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
