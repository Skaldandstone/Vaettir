import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { repositoryProviderJson } from "./repositoryProviderHttp.js";
import {
  createDriveAuthorization, DRIVE_METADATA_SCOPE, driveAccountSchema, driveCatalogSchema,
  driveFileSchema, driveOAuthConfigured, driveOAuthRedirect, listDriveFiles, verifyDriveAuthorization,
} from "./googleDriveConnection.js";

vi.mock("./repositoryProviderHttp.js", () => ({ repositoryProviderJson: vi.fn() }));
const env = { GOOGLE_DRIVE_CLIENT_ID: "fixture-client.apps.googleusercontent.com", GOOGLE_DRIVE_CLIENT_SECRET: "synthetic-client-secret", WEB_APP_URL: "https://app.vaettir.com" };
const input = { clientId: env.GOOGLE_DRIVE_CLIENT_ID, clientSecret: env.GOOGLE_DRIVE_CLIENT_SECRET,
  redirectUri: "https://app.vaettir.com/connections/drive/callback", code: "synthetic-code", verifier: "v".repeat(64) };
const token = { access_token: "synthetic-access-token", token_type: "Bearer", expires_in: 3600, scope: DRIVE_METADATA_SCOPE };
const about = { user: { permissionId: "123456789", displayName: "Fixture Account", emailAddress: "fixture@example.com", me: true } };
const options = { folderId: null, search: "", after: null };
const file = { id: "file_123-X", name: "Synthetic document", mimeType: "application/vnd.google-apps.document",
  parents: ["folder_123"], modifiedTime: "2026-10-01T10:00:00.000Z" };
const normalizedFile = { ...file, url: "https://docs.google.com/document/d/file_123-X/edit" };
const normalizedAccount = { id: "123456789", name: "Fixture Account", email: "fixture@example.com" };
beforeEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });

describe("Google Drive OAuth metadata handoff", () => {
  it("requires complete configuration, a strict public HTTPS application root and a fixed callback", () => {
    expect(driveOAuthConfigured(env)).toBe(true);
    expect(driveOAuthRedirect(env)).toBe(input.redirectUri);
    expect(driveOAuthRedirect({ WEB_APP_URL: "https://app.vaettir.com:443/" })).toBe(input.redirectUri);
    for (const key of Object.keys(env)) expect(driveOAuthConfigured({ ...env, [key]: undefined })).toBe(false);
  });
  it.each(["", "http://app.vaettir.com", "https://app.vaettir.com/path", "https://user:pass@app.vaettir.com",
    "https://app.vaettir.com?redirect=evil", "https://app.vaettir.com#fragment", "https://app.vaettir.com:444",
    "https://localhost", "https://app.local", "https://127.0.0.1", "https://[::1]", "https://app.invalid",
    "https://app.vaettir.com\\path", " https://app.vaettir.com", "https://app..vaettir.com", "https://%61pp.vaettir.com"])(
    "rejects unsafe configured root %s without provider I/O", WEB_APP_URL => {
      expect(driveOAuthConfigured({ ...env, WEB_APP_URL })).toBe(false);
      expect(() => driveOAuthRedirect({ WEB_APP_URL })).toThrow();
      expect(repositoryProviderJson).not.toHaveBeenCalled();
    });
  it("creates distinct high-entropy actor-state and S256 PKCE handoffs with metadata-only online access", () => {
    const first = createDriveAuthorization(input.clientId, input.redirectUri);
    const second = createDriveAuthorization(input.clientId, input.redirectUri);
    expect(first.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.verifier).toMatch(/^[A-Za-z0-9_-]{64}$/);
    expect(first.state).not.toBe(second.state);
    expect(first.verifier).not.toBe(second.verifier);
    const url = new URL(first.url);
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: input.clientId, redirect_uri: input.redirectUri, response_type: "code", scope: DRIVE_METADATA_SCOPE,
      access_type: "online", include_granted_scopes: "false", prompt: "consent select_account", state: first.state,
      code_challenge: createHash("sha256").update(first.verifier).digest("base64url"), code_challenge_method: "S256",
    });
    expect(repositoryProviderJson).not.toHaveBeenCalled();
  });
  it.each(["http://app.vaettir.com/connections/drive/callback", "https://app.vaettir.com/other",
    "https://app.vaettir.com/connections/drive/callback?next=https://evil.example", "https://app.vaettir.com/connections/drive/callback#x",
    "https://app.vaettir.com/connections/drive/callback/", "https://localhost/connections/drive/callback"])(
    "rejects arbitrary callback %s", redirectUri => {
      expect(() => createDriveAuthorization(input.clientId, redirectUri)).toThrow();
      expect(repositoryProviderJson).not.toHaveBeenCalled();
    });
  it("exchanges only at Google's fixed token endpoint, verifies the current native Drive identity and discards refresh/ID tokens", async () => {
    vi.spyOn(Date, "now").mockReturnValueOnce(1790848800000).mockReturnValueOnce(1790848801000);
    vi.mocked(repositoryProviderJson).mockResolvedValueOnce({ ...token, refresh_token: "never-retained", id_token: "never-retained-id" }).mockResolvedValueOnce(about);
    const result = await verifyDriveAuthorization(input);
    expect(result).toEqual({ token: token.access_token, account: normalizedAccount, expiresAt: new Date(1790852370000) });
    expect(repositoryProviderJson).toHaveBeenNthCalledWith(1, "https://oauth2.googleapis.com", "/token", {
      form: new URLSearchParams({ client_id: input.clientId, client_secret: input.clientSecret, redirect_uri: input.redirectUri,
        code: input.code, code_verifier: input.verifier, grant_type: "authorization_code" }),
    });
    expect(repositoryProviderJson).toHaveBeenNthCalledWith(2, "https://www.googleapis.com",
      "/drive/v3/about?fields=user(permissionId,displayName,emailAddress,me)", { token: token.access_token });
    expect(JSON.stringify(result)).not.toContain("never-retained");
    vi.restoreAllMocks();
  });
  it("retains no more than an hour minus clock budget and supports account email privacy", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1790848800000);
    vi.mocked(repositoryProviderJson).mockResolvedValueOnce({ ...token, expires_in: 3920 }).mockResolvedValueOnce({ user: { ...about.user, emailAddress: undefined } });
    const result = await verifyDriveAuthorization(input);
    expect(result.account.email).toBeNull();
    expect(result.expiresAt.getTime()).toBe(1790848800000 + 3570000);
    vi.restoreAllMocks();
  });
  it.each([{}, { ...token, access_token: "" }, { ...token, access_token: "secret\r\nheader" },
    { ...token, expires_in: 0 }, { ...token, expires_in: 30 }, { ...token, expires_in: 86401 },
    { ...token, expires_in: "3600" }, { ...token, expires_in: 30.5 }, { ...token, token_type: "MAC" },
    { ...token, scope: undefined }, { ...token, scope: "https://www.googleapis.com/auth/drive" },
    { ...token, scope: `${DRIVE_METADATA_SCOPE} https://www.googleapis.com/auth/drive.readonly` }])(
    "rejects unverified token/scope response without requesting account", async response => {
      vi.mocked(repositoryProviderJson).mockResolvedValueOnce(response);
      await expect(verifyDriveAuthorization(input)).rejects.toThrow("could not verify read-only metadata access");
      expect(repositoryProviderJson).toHaveBeenCalledTimes(1);
    });
  it.each([{ ...about.user, permissionId: "" }, { ...about.user, permissionId: "anonymous" },
    { ...about.user, permissionId: "https://evil.example" }, { ...about.user, displayName: "" },
    { ...about.user, emailAddress: "not-email" }, { ...about.user, me: false }, { ...about.user, me: undefined }])(
    "rejects unverified/anonymous provider account", async user => {
      vi.mocked(repositoryProviderJson).mockResolvedValueOnce(token).mockResolvedValueOnce({ user });
      await expect(verifyDriveAuthorization(input)).rejects.toThrow("could not verify");
    });
  it.each([{ ...input, clientId: "client\nsecret" }, { ...input, clientSecret: "" }, { ...input, code: "bad\ncode" },
    { ...input, code: "c".repeat(4097) }, { ...input, verifier: "short" }, { ...input, verifier: "+".repeat(64) },
    { ...input, redirectUri: "https://localhost/connections/drive/callback" }])("validates exchange input before I/O", async invalid => {
      await expect(verifyDriveAuthorization(invalid)).rejects.toThrow();
      expect(repositoryProviderJson).not.toHaveBeenCalled();
    });
  it("does not expose token/code/secret or upstream body through failures", async () => {
    vi.mocked(repositoryProviderJson).mockRejectedValueOnce(new Error(`${input.code} ${input.clientSecret} ${token.access_token}`));
    const failure = await verifyDriveAuthorization(input).catch(error => error as Error);
    const serialized = `${String(failure)} ${JSON.stringify(failure)}`;
    expect(serialized).not.toMatch(/synthetic-code|synthetic-client-secret|synthetic-access-token/);
  });
  it("does not extend expiry across slow exchange/account verification", async () => {
    vi.spyOn(Date, "now").mockReturnValueOnce(1790848800000).mockReturnValueOnce(1790852400000);
    vi.mocked(repositoryProviderJson).mockResolvedValueOnce(token).mockResolvedValueOnce(about);
    await expect(verifyDriveAuthorization(input)).rejects.toThrow();
    vi.restoreAllMocks();
  });
});

describe("bounded Google Drive folder metadata catalog", () => {
  it("requests one fixed, bounded user-corpus metadata page and ignores unsafe URLs/content fields", async () => {
    vi.mocked(repositoryProviderJson).mockResolvedValueOnce({ files: [{ ...file, webViewLink: "https://evil.example/file", downloadUrl: "http://169.254.169.254", description: "never-read" }], incompleteSearch: false });
    expect(await listDriveFiles(token.access_token, options)).toEqual({ files: [normalizedFile], nextCursor: null });
    const [origin, path, auth] = vi.mocked(repositoryProviderJson).mock.calls[0]!;
    expect(origin).toBe("https://www.googleapis.com");
    expect(auth).toEqual({ token: token.access_token });
    const url = new URL(path, origin);
    expect(url.pathname).toBe("/drive/v3/files");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: "trashed = false and 'root' in parents and mimeType != 'application/vnd.google-apps.shortcut'",
      pageSize: "25", corpora: "user", spaces: "drive", supportsAllDrives: "false", includeItemsFromAllDrives: "false",
      orderBy: "folder,name_natural", fields: "nextPageToken,incompleteSearch,files(id,name,mimeType,modifiedTime,parents,driveId,trashed)",
    });
    expect(repositoryProviderJson).toHaveBeenCalledTimes(1);
  });
  it("escapes literal apostrophes/backslashes in search and treats an opaque cursor as data", async () => {
    vi.mocked(repositoryProviderJson).mockResolvedValueOnce({ files: [file], nextPageToken: "new+/=&cursor" });
    const result = await listDriveFiles(token.access_token, { folderId: "folder_123", search: "quinn's paper\\essay' or trashed = true", after: "previous+/=&cursor" });
    const url = new URL(vi.mocked(repositoryProviderJson).mock.calls[0]![1], "https://www.googleapis.com");
    expect(url.searchParams.get("q")).toBe("trashed = false and 'folder_123' in parents and mimeType != 'application/vnd.google-apps.shortcut' and name contains 'quinn\\'s paper\\\\essay\\' or trashed = true'");
    expect(url.searchParams.get("pageToken")).toBe("previous+/=&cursor");
    expect(result.nextCursor).toBe("new+/=&cursor");
  });
  it.each([{}, { files: [] }, { files: [], nextPageToken: "next-empty-page" }])("allows documented empty/partial pages without declaring exhaustion early", async page => {
    vi.mocked(repositoryProviderJson).mockResolvedValueOnce(page);
    const result = await listDriveFiles(token.access_token, options);
    expect(result.files).toEqual([]);
    expect(result.nextCursor).toBe("nextPageToken" in page ? page.nextPageToken : null);
  });
  it.each([
    ["application/vnd.google-apps.folder", "https://drive.google.com/drive/folders/file_123-X"],
    ["application/vnd.google-apps.document", "https://docs.google.com/document/d/file_123-X/edit"],
    ["application/vnd.google-apps.spreadsheet", "https://docs.google.com/spreadsheets/d/file_123-X/edit"],
    ["application/vnd.google-apps.presentation", "https://docs.google.com/presentation/d/file_123-X/edit"],
    ["application/vnd.google-apps.form", "https://docs.google.com/forms/d/file_123-X/edit"],
    ["application/pdf", "https://drive.google.com/file/d/file_123-X/view"],
  ])("derives native browser links for %s", async (mimeType, url) => {
    vi.mocked(repositoryProviderJson).mockResolvedValueOnce({ files: [{ ...file, mimeType, modifiedTime: undefined, parents: undefined }] });
    expect((await listDriveFiles(token.access_token, options)).files[0]).toEqual({ id: file.id, name: file.name, mimeType, url, modifiedTime: null, parents: [] });
  });
  it.each([{ files: [file], incompleteSearch: true }, { files: [{ ...file, driveId: "sharedDrive_1" }] },
    { files: [file, file] }, { files: Array.from({ length: 26 }, (_, index) => ({ ...file, id: `file_${index}` })) },
    { files: [{ ...file, id: "../escape" }] }, { files: [{ ...file, id: "https://evil.example" }] },
    { files: [{ ...file, mimeType: "application/vnd.google-apps.shortcut" }] }, { files: [{ ...file, trashed: true }] },
    { files: [{ ...file, name: "\nunsafe" }] }, { files: [{ ...file, modifiedTime: "not-a-time" }] },
    { files: [{ ...file, parents: ["first", "second"] }] }, { files: [file], nextPageToken: "" },
    { files: [file], nextPageToken: "bad\rcursor" }])("rejects unsafe/incomplete metadata responses", async page => {
      vi.mocked(repositoryProviderJson).mockResolvedValueOnce(page);
      await expect(listDriveFiles(token.access_token, options)).rejects.toThrow("could not list this metadata page");
      expect(repositoryProviderJson).toHaveBeenCalledTimes(1);
    });
  it("rejects repeated cursors and results outside the explicitly chosen folder", async () => {
    vi.mocked(repositoryProviderJson).mockResolvedValueOnce({ files: [file], nextPageToken: "same" });
    await expect(listDriveFiles(token.access_token, { ...options, after: "same" })).rejects.toThrow();
    vi.mocked(repositoryProviderJson).mockResolvedValueOnce({ files: [file] });
    await expect(listDriveFiles(token.access_token, { ...options, folderId: "anotherFolder" })).rejects.toThrow();
  });
  it.each([{ ...options, folderId: "folder' or trashed = true" }, { ...options, folderId: "https://evil.example" },
    { ...options, search: "x".repeat(201) }, { ...options, search: "bad\nquery" },
    { ...options, after: "x".repeat(2049) }, { ...options, after: "bad\nheader" }])("validates bounded query input before I/O", async invalid => {
      await expect(listDriveFiles(token.access_token, invalid)).rejects.toThrow();
      expect(repositoryProviderJson).not.toHaveBeenCalled();
    });
  it.each(["", "bad\r\nAuthorization:bad", "x".repeat(10001)])("validates bearer token before I/O", async invalid => {
    await expect(listDriveFiles(invalid, options)).rejects.toThrow();
    expect(repositoryProviderJson).not.toHaveBeenCalled();
  });
  it("does not expose token/upstream body via listing errors", async () => {
    vi.mocked(repositoryProviderJson).mockRejectedValueOnce(new Error(`${token.access_token} body-private-data`));
    const failure = await listDriveFiles(token.access_token, options).catch(error => error as Error);
    expect(`${String(failure)} ${JSON.stringify(failure)}`).not.toMatch(/synthetic-access-token|body-private-data/);
  });
  it("normalizes RFC3339 time zones and never returns provider extra fields", async () => {
    vi.mocked(repositoryProviderJson).mockResolvedValueOnce({ files: [{ ...file, modifiedTime: "2026-10-01T12:00:00+02:00", content: "not retained" }] });
    expect((await listDriveFiles(token.access_token, options)).files).toEqual([normalizedFile]);
  });
  it("checks durable catalog identities and native browser links", () => {
    expect(driveCatalogSchema.safeParse({ account: normalizedAccount, files: [normalizedFile], nextCursor: null }).success).toBe(true);
    expect(driveCatalogSchema.safeParse({ account: normalizedAccount, files: [normalizedFile, normalizedFile], nextCursor: null }).success).toBe(false);
    expect(driveFileSchema.safeParse({ ...normalizedFile, url: "https://evil.example/file" }).success).toBe(false);
    expect(driveFileSchema.safeParse({ ...normalizedFile, url: `${normalizedFile.url}?target=https://evil.example` }).success).toBe(false);
    expect(driveAccountSchema.safeParse({ ...normalizedAccount, id: "anonymous" }).success).toBe(false);
  });
});
