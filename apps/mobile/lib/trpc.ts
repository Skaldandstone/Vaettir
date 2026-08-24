import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import Constants from "expo-constants";
import type { AppRouter } from "@tci/api/src/router";

const API_URL = (Constants.expoConfig?.extra?.apiUrl as string) ?? "http://localhost:4000";

export const trpc = createTRPCProxyClient<AppRouter>({
  links: [httpBatchLink({ url: `${API_URL}/trpc` })],
});
