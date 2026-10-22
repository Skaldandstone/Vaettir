-- Synthetic rows only, consumed exclusively by the owned loopback SQL runner.
INSERT INTO "PlanTier" ("id", "key", "name", "sortOrder", "minFullSeats")
VALUES ('identity-upgrade-tier', 'identity-upgrade-tier', 'Synthetic upgrade canary', 0, 0);
INSERT INTO "Organization" ("id", "name", "slug", "planTierId", "suspendedAt") VALUES
('identity-upgrade-active', 'Synthetic active workspace', 'identity-upgrade-active', 'identity-upgrade-tier', NULL),
('identity-upgrade-suspended', 'Synthetic suspended workspace', 'identity-upgrade-suspended', 'identity-upgrade-tier', '2026-01-01');
INSERT INTO "User" ("id", "clerkUserId", "email") VALUES
('identity-upgrade-owner', 'synthetic-upgrade-owner', 'owner@example.invalid'),
('identity-upgrade-reader', 'synthetic-upgrade-reader', 'reader@example.invalid');
INSERT INTO "Membership" ("id", "organizationId", "userId", "role", "seatType") VALUES
('identity-upgrade-owner-membership', 'identity-upgrade-active', 'identity-upgrade-owner', 'OWNER', 'FULL'),
('identity-upgrade-reader-membership', 'identity-upgrade-active', 'identity-upgrade-reader', 'VIEWER', 'READ_ONLY'),
('identity-upgrade-suspended-membership', 'identity-upgrade-suspended', 'identity-upgrade-owner', 'ADMIN', 'FULL');
