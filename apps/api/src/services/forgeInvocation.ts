import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { z } from "@vaettir/core/dist/validation.js";
import { jiraVersionMetadata } from "./forgeReleaseSchema.js";

const jwks = createRemoteJWKSet(
  new URL("https://forge.cdn.prod.atlassian-dev.net/.well-known/jwks.json"),
);
const numericId = z.string().regex(/^\d{1,40}$/);
const claims = z.object({
  app: z.object({
    id: z.string(),
    installationId: z.string().min(1).max(200),
    apiBaseUrl: z.string().url(),
    environment: z.object({
      id: z.string(),
      type: z.enum(["DEVELOPMENT", "STAGING", "PRODUCTION"]),
    }),
    installation: z.object({ id: z.string() }).optional(),
  }),
  context: z.object({
    cloudId: z.string().uuid(),
    siteUrl: z.string().url(),
    moduleKey: z.enum([
      "vaettir-project-quality",
      "vaettir-issue-quality",
      "vaettir-release-quality",
    ]),
    extension: z
      .object({
        project: z.object({ id: numericId }).optional(),
        issue: z.object({ id: numericId }).optional(),
        space: z.object({ id: numericId }).optional(),
        content: z.object({ id: numericId }).optional(),
      })
      .passthrough(),
  }),
  principal: z.string().min(1).max(200),
  exp: z.number(),
  iat: z.number(),
  icLabel: z.unknown().optional(),
});
export type ForgeIdentity = {
  appId: string;
  installationId: string;
  environmentId: string;
  cloudId: string;
  siteOrigin: string;
  product: "jira" | "confluence";
  targetId: string;
  principal: string;
  moduleKey: string;
  apiBaseUrl: string;
  resourceId?: string;
  issueKey?: string;
};

/** Only the pinned Atlassian keyset is used in production. Never decode and
 * trust a token, fetch a caller-provided JWKS URL, or use body tenant IDs. */
export async function verifyForgeInvocation(
  token: string,
  appId: string,
  environmentId: string,
  keys: JWTVerifyGetKey = jwks,
): Promise<ForgeIdentity> {
  if (!appId || !environmentId || token.length > 32000)
    throw new Error("Forge is not configured");
  const { payload } = await jwtVerify(token, keys, {
    issuer: "forge/invocation-token",
    audience: appId,
    algorithms: ["RS256"],
    maxTokenAge: "5m",
    clockTolerance: 5,
  });
  const data = claims.parse(payload);
  if (
    data.icLabel !== undefined ||
    data.app.id !== appId ||
    data.app.environment.id !== environmentId ||
    (data.app.installation &&
      data.app.installation.id !== data.app.installationId)
  )
    throw new Error("Forge context mismatch");
  const product =
    data.context.moduleKey === "vaettir-release-quality"
      ? "confluence"
      : "jira";
  if (
    data.app.apiBaseUrl !==
    `https://api.atlassian.com/ex/${product}/${data.context.cloudId}`
  )
    throw new Error("Unsupported Atlassian API origin");
  const extension = data.context.extension;
  const site = new URL(data.context.siteUrl);
  if (
    site.protocol !== "https:" ||
    !site.hostname.endsWith(".atlassian.net") ||
    site.port ||
    site.username ||
    site.password ||
    site.search ||
    site.hash ||
    !["", "/"].includes(site.pathname)
  )
    throw new Error("Unsupported site origin");
  const targetId =
    product === "jira" ? extension.project?.id : extension.space?.id;
  const resourceId =
    product === "confluence"
      ? extension.content?.id
      : data.context.moduleKey === "vaettir-issue-quality"
        ? extension.issue?.id
        : undefined;
  if (
    !targetId ||
    ((product === "confluence" ||
      data.context.moduleKey === "vaettir-issue-quality") &&
      !resourceId)
  )
    throw new Error("Missing trusted resource context");
  return {
    appId,
    installationId: data.app.installationId,
    environmentId,
    cloudId: data.context.cloudId,
    siteOrigin: site.origin,
    product,
    targetId,
    principal: data.principal,
    moduleKey: data.context.moduleKey,
    apiBaseUrl: data.app.apiBaseUrl,
    resourceId,
  };
}

export async function productJson(
  url: string,
  token: string,
  transport: typeof fetch,
) {
  const response = await transport(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok || !response.body)
    throw new Error("Atlassian access not verified");
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 65536)
        throw new Error("Atlassian response exceeded verification bound");
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

export type ForgeEventIdentity = Pick<
  ForgeIdentity,
  "appId" | "installationId" | "environmentId" | "cloudId" | "apiBaseUrl"
>;
/** Backend-only FIT. A UI invocation always contains additional module/page
 * context and cannot turn its user token into an automated release event. The
 * only hosted backend functions in this manifest are the private release queue. */
export async function verifyForgeEventInvocation(
  token: string,
  appId: string,
  environmentId: string,
  keys: JWTVerifyGetKey = jwks,
): Promise<ForgeEventIdentity> {
  if (!appId || !environmentId || token.length > 32000)
    throw new Error("Forge is not configured");
  const { payload } = await jwtVerify(token, keys, {
    issuer: "forge/invocation-token",
    audience: appId,
    algorithms: ["RS256"],
    maxTokenAge: "5m",
    clockTolerance: 5,
  });
  const data = z
    .object({
      app: z.object({
        id: z.literal(appId),
        installationId: z.string().min(1).max(200),
        apiBaseUrl: z.string(),
        environment: z.object({ id: z.literal(environmentId) }),
        installation: z.object({ id: z.string() }).optional(),
        module: z.object({ key: z.string().min(1), type: z.string().min(1) }),
      }),
      context: z.object({ cloudId: z.string().uuid() }).strict(),
      exp: z.number(),
      iat: z.number(),
      icLabel: z.unknown().optional(),
    })
    .parse(payload);
  if (
    data.icLabel !== undefined ||
    data.app.apiBaseUrl !==
      `https://api.atlassian.com/ex/jira/${data.context.cloudId}` ||
    (data.app.installation &&
      data.app.installation.id !== data.app.installationId)
  )
    throw new Error("Untrusted background invocation");
  return {
    appId,
    environmentId,
    cloudId: data.context.cloudId,
    installationId: data.app.installationId,
    apiBaseUrl: data.app.apiBaseUrl,
  };
}

export async function readForgeJiraVersion(
  identity: Pick<ForgeIdentity, "apiBaseUrl">,
  token: string,
  versionId: string,
  transport: typeof fetch = fetch,
) {
  if (
    !/^\d{1,40}$/.test(versionId) ||
    !token ||
    token.length > 16000 ||
    /[\r\n]/.test(token)
  )
    throw new Error("Missing version authorization");
  const version = jiraVersionMetadata.parse(
    await productJson(
      `${identity.apiBaseUrl}/rest/api/3/version/${versionId}`,
      token,
      transport,
    ),
  );
  if (version.id !== versionId)
    throw new Error("Jira version identity conflict");
  return version;
}
/** The short-lived appUser token is forwarded only to the verified Atlassian
 * API origin. It is never persisted, logged, sent to AI, or used as app/bot. */
export async function verifyForgeViewer(
  identity: ForgeIdentity,
  userToken: string,
  transport: typeof fetch = fetch,
) {
  if (!userToken || userToken.length > 16000 || /[\r\n]/.test(userToken))
    throw new Error("Missing Forge user authorization");
  if (identity.product === "jira") {
    const permissions = z.object({
      permissions: z.object({
        BROWSE_PROJECTS: z.object({ havePermission: z.literal(true) }),
      }),
    });
    permissions.parse(
      await productJson(
        `${identity.apiBaseUrl}/rest/api/3/mypermissions?projectId=${identity.targetId}&permissions=BROWSE_PROJECTS`,
        userToken,
        transport,
      ),
    );
    if (identity.resourceId) {
      const issue = z.object({
        id: z.literal(identity.resourceId),
        key: z.string().regex(/^[A-Z][A-Z0-9_]*-\d+$/),
        fields: z.object({
          project: z.object({ id: z.literal(identity.targetId) }),
        }),
      });
      const verified = issue.parse(
        await productJson(
          `${identity.apiBaseUrl}/rest/api/3/issue/${identity.resourceId}?fields=project`,
          userToken,
          transport,
        ),
      );
      return { ...identity, issueKey: verified.key };
    }
  } else {
    const page = z.object({
      id: z.literal(identity.resourceId!),
      spaceId: z.literal(identity.targetId),
      status: z.literal("current"),
    });
    page.parse(
      await productJson(
        `${identity.apiBaseUrl}/wiki/api/v2/pages/${identity.resourceId}`,
        userToken,
        transport,
      ),
    );
  }
  return identity;
}
