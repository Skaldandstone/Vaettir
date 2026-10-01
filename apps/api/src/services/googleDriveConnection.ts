import { createHash, randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { z } from "zod";
import { repositoryProviderJson } from "./repositoryProviderHttp.js";

// Metadata only, never file content/export, refresh tokens or shared-drive access.
// https://developers.google.com/identity/protocols/oauth2/web-server
// https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list
// https://developers.google.com/workspace/drive/api/reference/rest/v3/User
export const DRIVE_METADATA_SCOPE = "https://www.googleapis.com/auth/drive.metadata.readonly";
const DRIVE_API_ORIGIN = "https://www.googleapis.com";
const GOOGLE_TOKEN_ORIGIN = "https://oauth2.googleapis.com";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const SHORTCUT_MIME = "application/vnd.google-apps.shortcut";
const nativeId = z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/);
const noControls = (value: string) => Array.from(value).every(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127);
const label = z.string().min(1).max(1000).refine(value => value.trim().length > 0 && noControls(value));
const mime = z.string().min(1).max(200).regex(/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/);
const opaque = z.string().min(1).max(10000).regex(/^[\x21-\x7e]+$/);
const cursor = z.string().min(1).max(2048).regex(/^[\x21-\x7e]+$/);
const clientIdSchema = z.string().min(1).max(300).regex(/^[A-Za-z0-9._-]+$/);
const timestamp = z.string().max(40).datetime({ offset: true }).refine(value => Number.isFinite(Date.parse(value)));

function fileUrl(id: string, mimeType: string) {
  if (mimeType === FOLDER_MIME) return `https://drive.google.com/drive/folders/${id}`;
  const editor = ({
    "application/vnd.google-apps.document": "document",
    "application/vnd.google-apps.spreadsheet": "spreadsheets",
    "application/vnd.google-apps.presentation": "presentation",
    "application/vnd.google-apps.form": "forms",
  } as Record<string, string>)[mimeType];
  return editor ? `https://docs.google.com/${editor}/d/${id}/edit` : `https://drive.google.com/file/d/${id}/view`;
}

export const driveFileSchema = z.object({
  id: nativeId,
  name: label,
  mimeType: mime.refine(value => value !== SHORTCUT_MIME),
  url: z.string().url().max(1000),
  modifiedTime: timestamp.nullable(),
  parents: z.array(nativeId).max(1),
}).superRefine((file, ctx) => {
  if (file.url !== fileUrl(file.id, file.mimeType))
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid Google Drive file link" });
});
export const driveAccountSchema = z.object({
  id: nativeId.refine(value => !/^(unknown|anonymous|deleted|null|undefined)$/i.test(value)),
  name: label,
  email: z.string().email().max(320).nullable(),
});
export const driveCatalogSchema = z.object({
  account: driveAccountSchema,
  files: z.array(driveFileSchema).max(500),
  nextCursor: cursor.nullable(),
}).superRefine((catalog, ctx) => {
  if (new Set(catalog.files.map(file => file.id)).size !== catalog.files.length)
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Duplicate Google Drive file identity" });
});
export type DriveFile = z.infer<typeof driveFileSchema>;
export type DriveAccount = z.infer<typeof driveAccountSchema>;

type DriveEnvironment = Readonly<Record<string, string | undefined>>;

/** An administrator-supplied HTTPS root, never a callback URL supplied by a user. */
export function driveOAuthRedirect(env: DriveEnvironment = process.env): string {
  const raw = env.WEB_APP_URL ?? "";
  if (!/^https:\/\/[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?(?::443)?\/?$/i.test(raw))
    throw new Error("Google Drive needs a configured public HTTPS application URL.");
  const url = new URL(raw);
  if (isIP(url.hostname) || !url.hostname.includes(".") || /\.(localhost|local|internal|invalid|test)$/i.test(url.hostname) ||
      !url.hostname.split(".").every(part => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(part)))
    throw new Error("Google Drive needs a configured public HTTPS application URL.");
  return `${url.origin}/connections/drive/callback`;
}

export function driveOAuthConfigured(env: DriveEnvironment = process.env): boolean {
  try {
    clientIdSchema.parse(env.GOOGLE_DRIVE_CLIENT_ID);
    opaque.parse(env.GOOGLE_DRIVE_CLIENT_SECRET);
    driveOAuthRedirect(env);
    return true;
  } catch { return false; }
}

function authorizationInputs(clientId: string, redirectUri: string) {
  clientIdSchema.parse(clientId);
  const callback = new URL(redirectUri);
  if (driveOAuthRedirect({ WEB_APP_URL: callback.origin }) !== redirectUri)
    throw new Error("Google Drive needs its fixed HTTPS callback URL.");
}

/** Caller retains an actor-bound one-use state and encrypted verifier before opening this URL. */
export function createDriveAuthorization(clientId: string, redirectUri: string) {
  try { authorizationInputs(clientId, redirectUri); }
  catch { throw new Error("Google Drive authorization is not configured safely."); }
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, response_type: "code",
    scope: DRIVE_METADATA_SCOPE, access_type: "online", include_granted_scopes: "false",
    prompt: "consent select_account", state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  }).toString();
  return { state, verifier, url: url.href };
}

export async function verifyDriveAuthorization(input: {
  clientId: string; clientSecret: string; redirectUri: string; code: string; verifier: string;
}): Promise<{ token: string; expiresAt: Date; account: DriveAccount }> {
  try {
    authorizationInputs(input.clientId, input.redirectUri);
    opaque.parse(input.clientSecret);
    opaque.max(4096).parse(input.code);
    z.string().length(64).regex(/^[A-Za-z0-9_-]+$/).parse(input.verifier);
    // Start before exchange so slow I/O cannot extend the provider's token lifetime.
    const startedAt = Date.now();
    const response = z.object({
      access_token: opaque, token_type: z.string().refine(value => value.toLowerCase() === "bearer"),
      expires_in: z.number().int().min(31).max(86400), scope: z.literal(DRIVE_METADATA_SCOPE),
    }).parse(await repositoryProviderJson(GOOGLE_TOKEN_ORIGIN, "/token", {
      form: new URLSearchParams({
        client_id: input.clientId, client_secret: input.clientSecret, redirect_uri: input.redirectUri,
        code: input.code, code_verifier: input.verifier, grant_type: "authorization_code",
      }),
    }));
    const about = z.object({ user: z.object({
      permissionId: nativeId, displayName: label,
      emailAddress: z.string().email().max(320).optional(), me: z.literal(true),
    }) }).parse(await repositoryProviderJson(DRIVE_API_ORIGIN,
      "/drive/v3/about?fields=user(permissionId,displayName,emailAddress,me)", { token: response.access_token }));
    const account = driveAccountSchema.parse({
      id: about.user.permissionId, name: about.user.displayName, email: about.user.emailAddress ?? null,
    });
    const expiresAt = new Date(startedAt + Math.min(response.expires_in, 3600) * 1000 - 30000);
    if (expiresAt.getTime() <= Date.now()) throw new Error("Expired Google token");
    // Unknown response fields, including refresh_token/id_token, are never retained.
    return { token: response.access_token, expiresAt, account };
  } catch {
    // Provider errors/schema errors can contain upstream secrets or account details.
    throw new Error("Google Drive could not verify read-only metadata access. Reauthorize and check the app configuration.");
  }
}

const providerFileSchema = z.object({
  id: nativeId, name: label, mimeType: mime.refine(value => value !== SHORTCUT_MIME),
  modifiedTime: timestamp.optional(), parents: z.array(nativeId).max(1).optional(),
  driveId: nativeId.optional(), trashed: z.literal(false).optional(),
});
const providerPageSchema = z.object({
  files: z.array(providerFileSchema).max(25).default([]),
  nextPageToken: cursor.optional(), incompleteSearch: z.boolean().optional(),
});

/** One bounded metadata GET through DNS/TLS pinning, a 15s deadline and a 1MiB cap.
 * Search is within the chosen folder, with null meaning My Drive root. No raw
 * query, remote URL, shortcut target, shared-drive or content endpoint is followed.
 */
export async function listDriveFiles(token: string, options: {
  folderId: string | null; search: string; after: string | null;
}): Promise<{ files: DriveFile[]; nextCursor: string | null }> {
  try {
    opaque.parse(token);
    const input = z.object({
      folderId: nativeId.nullable(), search: z.string().max(200).refine(noControls),
      after: cursor.nullable(),
    }).parse(options);
    const folder = input.folderId ?? "root";
    const search = input.search.trim().replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const q = `trashed = false and '${folder}' in parents and mimeType != '${SHORTCUT_MIME}'` +
      (search ? ` and name contains '${search}'` : "");
    const params = new URLSearchParams({
      q, pageSize: "25", corpora: "user", spaces: "drive", supportsAllDrives: "false",
      includeItemsFromAllDrives: "false", orderBy: "folder,name_natural",
      fields: "nextPageToken,incompleteSearch,files(id,name,mimeType,modifiedTime,parents,driveId,trashed)",
    });
    if (input.after) params.set("pageToken", input.after);
    const page = providerPageSchema.parse(await repositoryProviderJson(DRIVE_API_ORIGIN,
      `/drive/v3/files?${params}`, { token }));
    if (page.incompleteSearch || page.files.some(file => file.driveId !== undefined) ||
        (input.after !== null && page.nextPageToken === input.after) ||
        new Set(page.files.map(file => file.id)).size !== page.files.length ||
        (input.folderId !== null && page.files.some(file => !file.parents?.includes(input.folderId!))))
      throw new Error("Unsupported or inconsistent Google Drive catalog");
    const files = page.files.map(file => driveFileSchema.parse({
      id: file.id, name: file.name, mimeType: file.mimeType, url: fileUrl(file.id, file.mimeType),
      modifiedTime: file.modifiedTime ? new Date(file.modifiedTime).toISOString() : null,
      parents: file.parents ?? [],
    }));
    // Empty/short pages with a next token are documented and must remain navigable.
    return { files, nextCursor: page.nextPageToken ?? null };
  } catch {
    throw new Error("Google Drive could not list this metadata page. Retry or restart the list; shared drives and shortcuts are not supported.");
  }
}
