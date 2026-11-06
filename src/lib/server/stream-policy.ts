import { error } from "@sveltejs/kit";

/** Provider redirects and CDN URLs need no configuration; only HTTP(S) URLs are fetched. */
export function streamTarget(value: string): URL {
  let target: URL;
  try {
    target = new URL(value);
  } catch {
    error(400, "Invalid stream URL");
  }
  if (!["http:", "https:"].includes(target.protocol) || target.username || target.password) {
    error(403, "Stream URL must use HTTP or HTTPS without embedded credentials");
  }
  return target;
}
