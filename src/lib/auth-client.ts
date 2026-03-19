import { createAuthClient } from "better-auth/svelte";
import { adminClient, usernameClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  baseURL: typeof window !== "undefined" ? window.location.origin : "http://localhost:5173",
  plugins: [usernameClient(), adminClient()],
});
