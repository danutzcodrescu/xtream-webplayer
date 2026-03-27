import pino from "pino";

const isProd = process.env.NODE_ENV === "production";

/**
 * Root structured logger.
 *
 * Level priority (lowest → highest): trace | debug | info | warn | error | fatal
 *
 * Override at runtime:
 *   LOG_LEVEL=debug  pnpm dev        (verbose)
 *   LOG_LEVEL=warn   node build      (quiet)
 *
 * Default: "debug" in development, "info" in production.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isProd ? "info" : "debug"),
  ...(isProd
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            ignore: "pid,hostname",
            translateTime: "HH:MM:ss.l",
          },
        },
      }),
});
