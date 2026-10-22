import { Prisma, type PrismaClient } from "@vaettir/db";
import { z } from "zod";

/** Internal worker storage, NOT an authorization API or provider adapter.
 * No route or scheduler calls this until an authenticated adapter and provider
 * acceptance exist. Validation establishes shape/binding, not authenticity.
 * Never pass a browser payload or an unverified webhook directly to commit.
 */
const identifier = z.string().min(1).max(512).refine(value => value.trim() === value);
const targetSchema = z.object({ organizationId: identifier, subjectId: identifier }).strict();
const ticketSchema = targetSchema.extend({
  generation: z.number().int().positive().max(2147483647),
  connectionRevision: z.number().int().positive(), subjectRevision: z.number().int().positive(),
}).strict();
export type DirectoryObservationTicket = z.infer<typeof ticketSchema>;
const observationSchema = z.object({
  providerInstanceId: identifier, providerConnectionId: identifier, providerDirectoryId: identifier,
  externalSubjectId: identifier, clerkSubject: identifier,
  complete: z.literal(true), active: z.boolean(),
  externalGroupIds: z.array(identifier).max(10000)
    .refine(values => new Set(values).size === values.length, "Duplicate source group"),
}).strict();
export type DirectoryObservation = z.infer<typeof observationSchema>;

export class DirectoryObservationConflict extends Error {
  constructor() { super("Directory observation is no longer current. Start a fresh authenticated read."); }
}
export class DirectoryObservationUnavailable extends Error {
  constructor() { super("Directory subject is unavailable for reconciliation."); }
}
function timestamp(clock: () => number) {
  const now = clock();
  if (!Number.isSafeInteger(now) || now < 0 || now > 8640000000000000 - 3600000) throw new DirectoryObservationUnavailable();
  return now;
}
async function loadSubject(db: Prisma.TransactionClient, target: z.infer<typeof targetSchema>) {
  const subject = await db.identityDirectorySubject.findUnique({
    where: { organizationId_id: { organizationId: target.organizationId, id: target.subjectId } },
    include: { connection: { include: { organization: { select: { suspendedAt: true } } } },
      membership: { include: { user: { select: { clerkUserId: true } } } } },
  });
  // Recheck source identity and tenant membership at reservation AND commit.
  // This does not create/restore native membership or change its seat/role.
  if (!subject || subject.organizationId !== target.organizationId || !subject.enabled
    || subject.connection.organizationId !== target.organizationId || !subject.connection.enabled
    || subject.connection.organization.suspendedAt
    || subject.membership.organizationId !== target.organizationId || subject.membership.userId !== subject.userId
    || subject.membership.user.clerkUserId !== subject.clerkSubject)
    throw new DirectoryObservationUnavailable();
  return subject;
}

/** No provider or credential handling here. Native membership is a prerequisite,
 * not something this store provisions. Receipts attribute work to the directory
 * source rather than impersonating the subject as a human audit actor.
 */
export function createIdentityDirectoryStore(prisma: PrismaClient, clock: () => number = Date.now) {
  async function transaction<T>(work: (db: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    try {
      return await prisma.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code))
        throw new DirectoryObservationConflict();
      throw error;
    }
  }

  return {
    // Internal evidence read, not a permission result. Native authorization,
    // entitlement and service-token boundaries still apply to every caller.
    async readCurrent(target: z.infer<typeof targetSchema>) {
      target = targetSchema.parse(target);
      return transaction(async db => {
        const subject = await loadSubject(db, target);
        const now = timestamp(clock);
        if (subject.appliedGeneration <= 0 || !subject.observedAt || !subject.expiresAt
          || subject.observedAt.getTime() > now || subject.expiresAt.getTime() <= now
          || subject.observedConnectionRevision !== subject.connection.revision
          || subject.observedSubjectRevision !== subject.revision) return null;
        return { organizationId: target.organizationId, connectionId: subject.connectionId,
          externalSubjectId: subject.externalSubjectId, userId: subject.userId, clerkSubject: subject.clerkSubject,
          generation: subject.appliedGeneration, active: subject.active,
          externalGroupIds: subject.active ? [...subject.externalGroupIds] : [],
          observedAt: subject.observedAt.toISOString(), expiresAt: subject.expiresAt.toISOString() };
      });
    },

    async reserve(target: z.infer<typeof targetSchema>): Promise<DirectoryObservationTicket> {
      target = targetSchema.parse(target);
      return transaction(async db => {
        const subject = await loadSubject(db, target);
        const lease = subject.connection.observationLeaseSeconds;
        if (!Number.isInteger(lease) || lease < 1 || lease > 3600) throw new DirectoryObservationUnavailable();
        if (subject.requestedGeneration >= 2147483647) throw new DirectoryObservationConflict();
        const now = timestamp(clock);
        const generation = subject.requestedGeneration + 1;
        const changed = await db.identityDirectorySubject.updateMany({
          where: { id: subject.id, organizationId: target.organizationId, revision: subject.revision,
            enabled: true, requestedGeneration: subject.requestedGeneration },
          data: { requestedGeneration: generation, reservedAt: new Date(now), reservedUntil: new Date(now + lease * 1000) },
        });
        if (changed.count !== 1) throw new DirectoryObservationConflict();
        return { ...target, generation, connectionRevision: subject.connection.revision, subjectRevision: subject.revision };
      });
    },

    async commit(ticket: DirectoryObservationTicket, observation: DirectoryObservation) {
      ticket = ticketSchema.parse(ticket); observation = observationSchema.parse(observation);
      return transaction(async db => {
        const subject = await loadSubject(db, ticket);
        const connection = subject.connection;
        const now = timestamp(clock);
        if (subject.revision !== ticket.subjectRevision || connection.revision !== ticket.connectionRevision
          || subject.requestedGeneration !== ticket.generation || subject.appliedGeneration >= ticket.generation
          || !subject.reservedAt || !subject.reservedUntil
          || subject.reservedAt.getTime() > now || subject.reservedUntil.getTime() <= now)
          throw new DirectoryObservationConflict();
        if (observation.providerInstanceId !== connection.providerInstanceId
          || observation.providerConnectionId !== connection.providerConnectionId
          || observation.providerDirectoryId !== connection.providerDirectoryId
          || observation.externalSubjectId !== subject.externalSubjectId
          || observation.clerkSubject !== subject.clerkSubject)
          throw new DirectoryObservationUnavailable();

        const groups = observation.active ? [...observation.externalGroupIds].sort() : [];
        const changed = await db.identityDirectorySubject.updateMany({
          where: { id: subject.id, organizationId: ticket.organizationId, revision: ticket.subjectRevision,
            enabled: true, requestedGeneration: ticket.generation, appliedGeneration: subject.appliedGeneration },
          data: { appliedGeneration: ticket.generation, active: observation.active, externalGroupIds: groups,
            observedConnectionRevision: ticket.connectionRevision, observedSubjectRevision: ticket.subjectRevision,
            observedAt: new Date(now), expiresAt: subject.reservedUntil },
        });
        if (changed.count !== 1) throw new DirectoryObservationConflict();
        // A failed receipt rolls back the observation too. No provider payload or
        // secret is logged; source linkage is retained via the subject record.
        await db.identityDirectoryReceipt.create({ data: {
          organizationId: ticket.organizationId, subjectId: subject.id, generation: ticket.generation,
          connectionRevision: ticket.connectionRevision, subjectRevision: ticket.subjectRevision,
          providerInstanceId: connection.providerInstanceId, providerConnectionId: connection.providerConnectionId,
          providerDirectoryId: connection.providerDirectoryId, externalSubjectId: subject.externalSubjectId,
          userId: subject.userId, clerkSubject: subject.clerkSubject,
          active: observation.active, groupCount: groups.length, externalGroupIds: groups,
          observedAt: new Date(now), expiresAt: subject.reservedUntil,
        } });
        return { generation: ticket.generation, active: observation.active, groupCount: groups.length,
          expiresAt: subject.reservedUntil.toISOString() };
      });
    },
  };
}
