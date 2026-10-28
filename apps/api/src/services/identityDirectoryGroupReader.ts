import { z } from "zod";

const identifier = z.string().min(1).max(512).refine(value => value.trim() === value
  && [...value].every(char => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127));
const directorySchema = z.object({ object: z.literal("directory"), id: identifier,
  enterprise_connection_id: identifier, enabled: z.literal(true), paused: z.literal(false),
  updated_at: z.number().int().nonnegative().safe() });
const groupSchema = z.object({ object: z.literal("directory_group"), id: identifier,
  updated_at: z.number().int().nonnegative().safe() });
const pageSchema = z.object({ data: z.array(z.object({ object: z.literal("directory_group_member"),
  id: identifier, user_id: identifier.nullable() })).max(500),
  cursor: z.object({ has_next_page: z.boolean(), starting_after: identifier.nullable().optional() }) });

export class IdentityDirectoryReadUnavailable extends Error {
  constructor() { super("Directory group evidence is unavailable. Start a fresh read."); }
}

/** Internal, read-only BAPI transport. Not registered with a route or scheduler.
 * Pins and credential must come from server-owned configuration. assertCurrent
 * must recheck tenant suspension, binding revision and the caller's authorization.
 * Result is group evidence only: it proves neither source-specific active state,
 * all groups for a subject, current-session SSO, nor an atomic provider snapshot.
 * Never pass this result to the observation store as a complete observation.
 */
export function createIdentityDirectoryGroupReader(options: {
  directoryId: string; enterpriseConnectionId: string; secretKey: string;
  assertCurrent: () => Promise<void>;
  fetch?: typeof globalThis.fetch;
}) {
  const directoryId = identifier.parse(options.directoryId);
  const connectionId = identifier.parse(options.enterpriseConnectionId);
  if (!/^sk_(test|live)_[A-Za-z0-9]+$/.test(options.secretKey)) throw new IdentityDirectoryReadUnavailable();
  const request = options.fetch ?? globalThis.fetch;
  const directoryPath = `/v1/directories/${encodeURIComponent(directoryId)}`;
  async function read(path: string) {
    await options.assertCurrent();
    const response = await request(`https://api.clerk.com${path}`, {
      method: "GET", headers: { Authorization: `Bearer ${options.secretKey}`, Accept: "application/json", "Cache-Control": "no-store", "Clerk-API-Version": "2026-08-20" },
      redirect: "error", signal: AbortSignal.timeout(10000),
    });
    if (response.status !== 200 || response.redirected || !response.body) {
      await response.body?.cancel().catch(() => {});
      throw new IdentityDirectoryReadUnavailable();
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 1048576) throw new IdentityDirectoryReadUnavailable();
        chunks.push(part.value);
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  }
  async function directory() {
    const value = directorySchema.parse(await read(directoryPath));
    if (value.id !== directoryId || value.enterprise_connection_id !== connectionId) throw new IdentityDirectoryReadUnavailable();
    return value;
  }
  return {
    async readGroupMembers(groupId: string) {
      try {
        identifier.parse(groupId);
        // encodeURIComponent leaves dot segments unchanged; reject them explicitly.
        if ([directoryId, groupId].some(value => value === "." || value === "..")) throw new IdentityDirectoryReadUnavailable();
        const path = `${directoryPath}/groups/${encodeURIComponent(groupId)}`;
        const before = await directory();
        const groupBefore = groupSchema.parse(await read(path));
        if (groupBefore.id !== groupId) throw new IdentityDirectoryReadUnavailable();
        const members: { externalSubjectId: string; clerkSubject: string | null }[] = [];
        const seenMembers = new Set<string>();
        const seenCursors = new Set<string>();
        let cursor: string | undefined;
        for (let count = 0; ; count++) {
          if (count >= 100) throw new IdentityDirectoryReadUnavailable();
          const query = new URLSearchParams({ limit: "500" });
          if (cursor !== undefined) query.set("starting_after", cursor);
          const page = pageSchema.parse(await read(`${path}/members?${query}`));
          for (const member of page.data) {
            if (seenMembers.has(member.id) || members.length >= 10000) throw new IdentityDirectoryReadUnavailable();
            seenMembers.add(member.id);
            members.push({ externalSubjectId: member.id, clerkSubject: member.user_id });
          }
          if (!page.cursor.has_next_page) break;
          const next = page.cursor.starting_after;
          if (!next || !page.data.length || seenCursors.has(next)) throw new IdentityDirectoryReadUnavailable();
          seenCursors.add(next); cursor = next;
        }
        const groupAfter = groupSchema.parse(await read(path));
        const after = await directory();
        if (JSON.stringify(before) !== JSON.stringify(after) || groupAfter.id !== groupId
          || groupBefore.updated_at !== groupAfter.updated_at) throw new IdentityDirectoryReadUnavailable();
        await options.assertCurrent();
        return { directoryId, enterpriseConnectionId: connectionId, externalGroupId: groupId, members };
      } catch {
        // Never expose credentials, raw provider errors, payloads or external IDs.
        throw new IdentityDirectoryReadUnavailable();
      }
    },
  };
}
