export const PUBLIC_INTERNAL_ERROR_MESSAGE =
  "Something went wrong while loading this data. Please try again. If it continues, contact beta support.";

type TrpcErrorShape = {
  message: string;
  data: {
    stack?: string;
  };
};

/**
 * Keep intentional client-facing errors useful, but never return internal
 * exception text or a stack trace to an API caller.
 */
export function publicTrpcErrorShape<T extends TrpcErrorShape>(code: string, shape: T): T {
  if (code !== "INTERNAL_SERVER_ERROR") return shape;

  const data = { ...shape.data };
  delete data.stack;

  return {
    ...shape,
    message: PUBLIC_INTERNAL_ERROR_MESSAGE,
    data,
  } as T;
}

/**
 * Fastify handles non-tRPC routes separately. Preserve actionable 4xx
 * responses while applying the same fail-safe default to unexpected 5xxs.
 */
export function publicHttpErrorMessage(statusCode: number, message: string): string {
  return statusCode >= 500 ? PUBLIC_INTERNAL_ERROR_MESSAGE : message;
}
