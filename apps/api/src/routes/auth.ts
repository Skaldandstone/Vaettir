import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "@tci/db";
import { hashPassword, verifyPassword, signSessionToken } from "../auth.js";

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().optional(),
  organizationName: z.string().min(1),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "org"
  );
}

export async function authRoutes(app: FastifyInstance) {
  // New user + new organization, seated as OWNER on the free tier. Joining
  // an *existing* org (an invite flow) is a separate, not-yet-built path --
  // see P1-08 (org/project settings UI) for where seat invites land.
  app.post("/auth/register", async (req, reply) => {
    const body = registerSchema.parse(req.body);

    const existing = await prisma.user.findUnique({ where: { email: body.email } });
    if (existing) {
      return reply.status(409).send({ error: "An account with that email already exists" });
    }

    const freeTier = await prisma.planTier.findUniqueOrThrow({ where: { key: "free" } });
    const passwordHash = await hashPassword(body.password);

    const baseSlug = slugify(body.organizationName);
    let slug = baseSlug;
    let suffix = 1;
    while (await prisma.organization.findUnique({ where: { slug } })) {
      slug = `${baseSlug}-${++suffix}`;
    }

    const { user, organization } = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email: body.email, name: body.name, passwordHash },
      });
      const organization = await tx.organization.create({
        data: { name: body.organizationName, slug, planTierId: freeTier.id },
      });
      await tx.membership.create({
        data: { organizationId: organization.id, userId: user.id, role: "OWNER", seatType: "FULL" },
      });
      return { user, organization };
    });

    const token = signSessionToken({ userId: user.id });
    return reply.status(201).send({
      token,
      user: { id: user.id, email: user.email, name: user.name },
      organization: { id: organization.id, name: organization.name, slug: organization.slug },
    });
  });

  app.post("/auth/login", async (req, reply) => {
    const body = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { email: body.email } });
    if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
      return reply.status(401).send({ error: "Invalid email or password" });
    }

    const token = signSessionToken({ userId: user.id });
    return reply.send({ token, user: { id: user.id, email: user.email, name: user.name } });
  });
}
