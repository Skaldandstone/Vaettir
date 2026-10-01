-- Public provider identity only. Existing Linear connections remain unchanged.
ALTER TABLE "TicketSourceConnection" ADD COLUMN "providerOrigin" TEXT;
