import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";

const REGION = process.env.AWS_REGION ?? "us-east-2";
const BUCKET = process.env.TEST_ARTIFACTS_BUCKET;

// P5-15: private bucket, presigned URLs both ways -- the runner-side
// reporter PUTs straight to S3 (never routing screenshot/video bytes
// through this API server) and the UI gets a short-lived signed GET when
// it actually needs to display one. Nothing here is ever public; there is
// no bucket policy granting anonymous access, only IAM-scoped PutObject/
// GetObject on this one bucket for whichever principal is signing.
let client: S3Client | undefined;
function getClient(): S3Client {
  if (!client) client = new S3Client({ region: REGION });
  return client;
}

function requireBucket(): string {
  if (!BUCKET) throw new Error("TEST_ARTIFACTS_BUCKET is not set");
  return BUCKET;
}

const EXTENSION_BY_TYPE: Record<"SCREENSHOT" | "VIDEO", string> = { SCREENSHOT: "png", VIDEO: "mp4" };
const CONTENT_TYPE_BY_TYPE: Record<"SCREENSHOT" | "VIDEO", string> = { SCREENSHOT: "image/png", VIDEO: "video/mp4" };

export function buildArtifactKey(projectId: string, testResultId: string, type: "SCREENSHOT" | "VIDEO"): string {
  return `test-artifacts/${projectId}/${testResultId}/${randomUUID()}.${EXTENSION_BY_TYPE[type]}`;
}

export async function createUploadUrl(key: string, type: "SCREENSHOT" | "VIDEO"): Promise<string> {
  const command = new PutObjectCommand({ Bucket: requireBucket(), Key: key, ContentType: CONTENT_TYPE_BY_TYPE[type] });
  return getSignedUrl(getClient(), command, { expiresIn: 300 });
}

export async function createViewUrl(key: string): Promise<string> {
  const command = new GetObjectCommand({ Bucket: requireBucket(), Key: key });
  return getSignedUrl(getClient(), command, { expiresIn: 300 });
}

// The canonical (non-presigned) locator stored on TestResultArtifact.
// Never directly fetchable -- the bucket blocks all public access -- but a
// stable identifier the object's actual key can always be recovered from,
// which is what createViewUrl needs to re-sign a fresh GET on demand.
export function canonicalUrl(key: string): string {
  return `s3://${requireBucket()}/${key}`;
}

export function keyFromCanonicalUrl(url: string): string {
  const prefix = `s3://${requireBucket()}/`;
  if (!url.startsWith(prefix)) throw new Error(`Unrecognized artifact URL: ${url}`);
  return url.slice(prefix.length);
}
