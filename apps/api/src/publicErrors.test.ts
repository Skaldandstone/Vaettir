import { describe, expect, it } from "vitest";
import {
  PUBLIC_INTERNAL_ERROR_MESSAGE,
  publicHttpErrorMessage,
  publicTrpcErrorShape,
  safeInternalErrorDetails,
} from "./publicErrors.js";

describe("public API errors", () => {
  it("logs only allowlisted operational error classification", () => {
    expect(safeInternalErrorDetails({name:"PrismaClientInitializationError",errorCode:"P1000",message:"postgres://private:secret@host/db"})).toEqual({errorType:"PrismaClientInitializationError",databaseCode:"P1000"});
    expect(safeInternalErrorDetails({name:"secret",code:"token",stack:"private"})).toEqual({errorType:"UnknownError",databaseCode:undefined});
    expect(safeInternalErrorDetails(null).errorType).toBe("UnknownError");
  });
  it("removes internal tRPC messages and stack traces", () => {
    const shape = publicTrpcErrorShape("INTERNAL_SERVER_ERROR", {
      message: "Invalid prisma.user.create() invocation: Unique constraint failed on email",
      code: -32603,
      data: {
        code: "INTERNAL_SERVER_ERROR",
        httpStatus: 500,
        path: "organization.mine",
        stack: "PrismaClientKnownRequestError: private implementation details",
      },
    });

    expect(shape.message).toBe(PUBLIC_INTERNAL_ERROR_MESSAGE);
    expect(shape.data).not.toHaveProperty("stack");
    expect(JSON.stringify(shape)).not.toContain("prisma.user.create");
    expect(JSON.stringify(shape)).not.toContain("PrismaClientKnownRequestError");
  });

  it("preserves deliberate client-facing tRPC errors", () => {
    const shape = {
      message: "Not a member of this organization",
      data: { code: "FORBIDDEN", httpStatus: 403 },
    };

    expect(publicTrpcErrorShape("FORBIDDEN", shape)).toBe(shape);
  });

  it("sanitizes raw 5xx responses but preserves actionable 4xx messages", () => {
    expect(publicHttpErrorMessage(500, "database connection string leaked")).toBe(
      PUBLIC_INTERNAL_ERROR_MESSAGE,
    );
    expect(publicHttpErrorMessage(503, "upstream token leaked")).toBe(
      PUBLIC_INTERNAL_ERROR_MESSAGE,
    );
    expect(publicHttpErrorMessage(400, "missing code or state")).toBe("missing code or state");
  });
});
