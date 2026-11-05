import { auth } from "$lib/server/auth";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = ({ request }) => auth.handler(request);

// Keep the empty-database check and initial signup together in this server process.
let signupQueue = Promise.resolve();
export const POST: RequestHandler = ({ request }) => {
  if (!new URL(request.url).pathname.startsWith("/api/auth/sign-up/")) return auth.handler(request);
  const response = signupQueue.then(() => auth.handler(request));
  signupQueue = response.then(
    () => undefined,
    () => undefined,
  );
  return response;
};
