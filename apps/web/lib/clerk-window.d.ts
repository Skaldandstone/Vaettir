// @clerk/nextjs attaches a global Clerk instance to `window` once loaded;
// this is a minimal ambient type for the one call site that reads off it
// directly (lib/trpc.ts) rather than importing Clerk's full global types.
export {};

declare global {
  interface Window {
    Clerk?: {
      loaded: boolean;
      load(): Promise<void>;
      session?: {
        getToken(): Promise<string | null>;
      } | null;
    };
  }
}
