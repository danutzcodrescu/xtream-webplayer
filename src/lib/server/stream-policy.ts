import { error } from "@sveltejs/kit";

/** Exact hostnames only: no schemes, paths, ports, or wildcard trust. */
export function parseAllowedCdnHosts(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 32)
    error(400, "Allowed CDN hosts must be a list of at most 32 hostnames");
  return [
    ...new Set(
      value.map((host) => {
        if (typeof host !== "string" || !host.trim()) error(400, "Invalid CDN hostname");
        const input = host.trim().toLowerCase();
        let parsed: URL;
        try {
          parsed = new URL(`https://${input}`);
        } catch {
          error(400, "Invalid CDN hostname");
        }
        if (
          parsed.hostname !== input ||
          parsed.host !== input ||
          parsed.pathname !== "/" ||
          parsed.search ||
          parsed.hash ||
          parsed.username ||
          parsed.password ||
          input.includes("*")
        ) {
          error(400, "Use exact CDN hostnames without a scheme, port, or path");
        }
        return parsed.hostname;
      }),
    ),
  ];
}

export function streamTarget(value: string, allowedHosts: readonly string[]): URL {
  let target: URL;
  try {
    target = new URL(value);
  } catch {
    error(400, "Invalid stream URL");
  }
  if (
    !["http:", "https:"].includes(target.protocol) ||
    target.username ||
    target.password ||
    !allowedHosts.includes(target.hostname)
  ) {
    error(403, "Stream host not permitted; configure allowed CDN hosts in Playlist settings");
  }
  return target;
}
