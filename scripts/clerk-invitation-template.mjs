import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const templateDir = path.join(root, "apps", "api", "src", "email-templates");
const htmlPath = path.join(templateDir, "private-beta-invitation.html");
const textPath = path.join(templateDir, "private-beta-invitation.txt");
const subjectPath = path.join(
  templateDir,
  "private-beta-invitation.subject.txt",
);
const clerkTemplateUrl = "https://api.clerk.com/v1/templates/email/invitation";

export async function loadInvitationTemplate() {
  const [body, plainText, subjectSource] = await Promise.all([
    readFile(htmlPath, "utf8"),
    readFile(textPath, "utf8"),
    readFile(subjectPath, "utf8"),
  ]);
  return { body, plainText, subject: subjectSource.trim() };
}

export function validateInvitationTemplate(template) {
  const errors = [];
  for (const [name, content] of [
    ["HTML", template.body],
    ["plain text", template.plainText],
  ]) {
    if (!content.includes("{{action_url}}"))
      errors.push(`${name} is missing {{action_url}}`);
    if (!content.includes("{{invitation.expires_in_days}}")) {
      errors.push(`${name} is missing {{invitation.expires_in_days}}`);
    }
    if (content.includes("—")) errors.push(`${name} contains an em dash`);
  }
  if (!template.body.toLowerCase().includes("<!doctype html>"))
    errors.push("HTML is missing a doctype");
  if (!template.body.includes('role="presentation"'))
    errors.push("HTML tables need presentation roles");
  if (!template.subject || template.subject.includes("{{action_url}}"))
    errors.push("Subject is invalid");
  if (
    !template.body.includes("500") ||
    !template.body.includes("5 full seats")
  ) {
    errors.push("HTML is missing the private-beta allowances");
  }
  if (
    !template.body.includes("non-regulated") ||
    !template.body.includes("AI provider")
  ) {
    errors.push("HTML is missing the beta data boundary and AI disclosure");
  }
  return errors;
}

function renderPreview(template) {
  const replacements = new Map([
    [
      "{{action_url}}",
      "https://vaettir.skaldandstone.com/sign-up?__clerk_ticket=preview",
    ],
    ["{{invitation.expires_in_days}}", "7"],
    ["{{app.name}}", "Vaettir"],
  ]);
  let rendered = template.body;
  for (const [token, value] of replacements)
    rendered = rendered.replaceAll(token, value);
  return rendered;
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function clerkRequest(secretKey, options = {}) {
  const response = await fetch(clerkTemplateUrl, {
    ...options,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(
      `Clerk template request failed (${response.status}): ${JSON.stringify(payload)}`,
    );
  }
  return payload;
}

async function inspectOrSync(template, apply) {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey?.startsWith("sk_"))
    throw new Error("CLERK_SECRET_KEY must be set to a Clerk secret key");

  const current = await clerkRequest(secretKey);
  const matches =
    current.subject?.trim() === template.subject &&
    current.body === template.body;
  console.log(
    JSON.stringify(
      {
        template: "email/invitation",
        currentHash: hash(
          `${current.subject?.trim() ?? ""}\n${current.body ?? ""}`,
        ),
        candidateHash: hash(`${template.subject}\n${template.body}`),
        matches,
        deliveredByClerk: current.delivered_by_clerk,
      },
      null,
      2,
    ),
  );
  if (!apply || matches) return;

  const scopes = process.env.CLERK_BAPI_SCOPES ?? "";
  const adminOverride = process.argv.includes("--admin");
  if (!scopes && !adminOverride) {
    throw new Error(
      "This is a write operation and your current scopes may not allow it. Rerun with --admin to bypass.",
    );
  }

  const backupDir = path.join(root, ".local", "clerk-template-backups");
  await mkdir(backupDir, { recursive: true });
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  const backupPath = path.join(backupDir, `invitation-${timestamp}.json`);
  await writeFile(backupPath, `${JSON.stringify(current, null, 2)}\n`, "utf8");

  const updated = await clerkRequest(secretKey, {
    method: "PUT",
    body: JSON.stringify({
      name: "Vaettir private beta invitation",
      subject: template.subject,
      body: template.body,
      from_email_name: "welcome",
      reply_to_email_name: "james",
      delivered_by_clerk: true,
    }),
  });
  console.log(
    JSON.stringify(
      {
        updated: true,
        slug: updated.slug,
        subject: updated.subject?.trim(),
        deliveredByClerk: updated.delivered_by_clerk,
        backupPath,
      },
      null,
      2,
    ),
  );
}

async function main() {
  const command = process.argv[2] ?? "check";
  const template = await loadInvitationTemplate();
  const errors = validateInvitationTemplate(template);
  if (errors.length) throw new Error(errors.join("\n"));

  if (command === "check") {
    console.log(
      `Invitation template valid (${hash(`${template.subject}\n${template.body}`)})`,
    );
    return;
  }
  if (command === "preview") {
    const outputDir = path.join(root, ".local", "email-previews");
    await mkdir(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, "private-beta-invitation.html");
    await writeFile(outputPath, renderPreview(template), "utf8");
    console.log(outputPath);
    return;
  }
  if (command === "inspect") return inspectOrSync(template, false);
  if (command === "sync")
    return inspectOrSync(template, process.argv.includes("--apply"));
  throw new Error(`Unknown command: ${command}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
