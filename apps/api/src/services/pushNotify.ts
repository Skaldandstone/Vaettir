import type { PrismaClient } from "@vaettir/db";

// P8-04: plain HTTPS POST to Expo's push service - no SDK needed for one
// call shape, same "hand-roll it, no library for one fixed integration"
// reasoning as githubApp.ts's JWT signing. Fire-and-forget from the caller,
// same convention as dispatchWebhookEvent/notifySlackEvent - a dead/slow
// push endpoint shouldn't slow down or fail the mutation that triggered it.
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

interface ExpoPushTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

// A token Expo reports as permanently dead (uninstalled app, etc.) is
// pruned immediately rather than left to fail silently forever on every
// future notification - the one piece of bookkeeping this integration
// needs beyond "send and forget."
async function pruneDeadTokens(prisma: PrismaClient, tokens: string[], tickets: ExpoPushTicket[]): Promise<void> {
  const dead = tokens.filter((_, i) => tickets[i]?.details?.error === "DeviceNotRegistered");
  if (dead.length === 0) return;
  await prisma.pushToken.deleteMany({ where: { token: { in: dead } } });
}

export async function sendPushToUser(
  prisma: PrismaClient,
  userId: string,
  notification: { title: string; body: string; data?: Record<string, unknown> },
): Promise<void> {
  const tokens = await prisma.pushToken.findMany({ where: { userId }, select: { token: true } });
  if (tokens.length === 0) return;

  const messages = tokens.map((t) => ({
    to: t.token,
    title: notification.title,
    body: notification.body,
    data: notification.data,
  }));

  const res = await fetch(EXPO_PUSH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(messages),
  });
  if (!res.ok) {
    throw new Error(`Expo push send failed: ${res.status} ${await res.text()}`);
  }
  const result = (await res.json()) as { data: ExpoPushTicket[] };
  await pruneDeadTokens(prisma, tokens.map((t) => t.token), result.data ?? []);
}
