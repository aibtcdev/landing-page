/**
 * Centralized Logger for AIBTC Landing Page
 *
 * Sends logs to worker-logs service via RPC binding.
 * Adapted from x402-api and x402-sponsor-relay logger implementations.
 *
 * Usage in Next.js route handlers:
 * ```ts
 * import { getCloudflareContext } from "@opennextjs/cloudflare";
 * import { createLogger, createConsoleLogger } from "@/lib/logging";
 *
 * export async function GET(request: NextRequest) {
 *   const { env, ctx } = await getCloudflareContext();
 *   const rayId = request.headers.get("cf-ray") || crypto.randomUUID();
 *   const logger = env.LOGS
 *     ? createLogger(env.LOGS, ctx, { rayId, path: request.nextUrl.pathname })
 *     : createConsoleLogger({ rayId, path: request.nextUrl.pathname });
 *
 *   logger.info("Processing request", { method: request.method });
 *   // ...
 * }
 * ```
 */

const APP_ID = "aibtc-landing";

/**
 * LogsRPC interface for worker-logs service binding.
 *
 * Matches the RPC entrypoint defined in worker-logs service.
 */
export interface LogsRPC {
  debug(
    appId: string,
    message: string,
    context?: Record<string, unknown>
  ): Promise<void>;
  info(
    appId: string,
    message: string,
    context?: Record<string, unknown>
  ): Promise<void>;
  warn(
    appId: string,
    message: string,
    context?: Record<string, unknown>
  ): Promise<void>;
  error(
    appId: string,
    message: string,
    context?: Record<string, unknown>
  ): Promise<void>;
}

/**
 * Logger interface for application logging.
 *
 * Provides standard log levels and context merging via child loggers.
 */
export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  child?(additionalContext: Record<string, unknown>): Logger;
}

/**
 * Type guard to check if LOGS binding has required RPC methods.
 *
 * Use this to safely check if env.LOGS is a valid LogsRPC instance
 * before passing it to createLogger.
 */
export function isLogsRPC(logs: unknown): logs is LogsRPC {
  return (
    typeof logs === "object" &&
    logs !== null &&
    typeof (logs as LogsRPC).info === "function" &&
    typeof (logs as LogsRPC).warn === "function" &&
    typeof (logs as LogsRPC).error === "function" &&
    typeof (logs as LogsRPC).debug === "function"
  );
}

// =============================================================================
// Console Fallback Logger (for local dev without LOGS binding)
// =============================================================================

/**
 * Create a console logger fallback for local development.
 *
 * Formats messages with timestamp, level, message, and merged context.
 * Used when LOGS binding is not available (local dev, missing binding).
 */
export function createConsoleLogger(
  baseContext?: Record<string, unknown>
): Logger {
  const formatMessage = (
    level: string,
    message: string,
    data?: Record<string, unknown>
  ) => {
    const timestamp = new Date().toISOString();
    const ctx = { ...baseContext, ...data };
    const ctxStr =
      Object.keys(ctx).length > 0 ? ` ${JSON.stringify(ctx)}` : "";
    return `[${timestamp}] ${level.toUpperCase().padEnd(5)} ${message}${ctxStr}`;
  };

  return {
    debug: (msg, data) => console.debug(formatMessage("debug", msg, data)),
    info: (msg, data) => console.info(formatMessage("info", msg, data)),
    warn: (msg, data) => console.warn(formatMessage("warn", msg, data)),
    error: (msg, data) => console.error(formatMessage("error", msg, data)),
    child: (additionalContext) =>
      createConsoleLogger({ ...baseContext, ...additionalContext }),
  };
}

// =============================================================================
// RPC Logger (production with worker-logs binding)
// =============================================================================

/**
 * Create a logger that sends to worker-logs via RPC.
 *
 * Logs are sent asynchronously using ctx.waitUntil() to avoid blocking
 * the response. If RPC calls fail, errors are logged to console as fallback.
 *
 * @param logs - LogsRPC binding from env.LOGS
 * @param ctx - ExecutionContext from getCloudflareContext().ctx
 * @param baseContext - Base context merged into every log (e.g., rayId, path)
 */
export function createLogger(
  logs: LogsRPC,
  ctx: Pick<ExecutionContext, "waitUntil">,
  baseContext?: Record<string, unknown>
): Logger {
  const send = (
    rpcCall: Promise<unknown>,
    level: string,
    message: string,
    context: Record<string, unknown>
  ) => {
    ctx.waitUntil(
      rpcCall.catch((err) => {
        const errorContext =
          err instanceof Error
            ? {
                errorName: err.name,
                errorMessage: err.message,
                errorStack: err.stack,
              }
            : {
                errorValue: err,
              };

        console.error("[logger] Failed to send log", {
          level,
          message,
          ...context,
          ...errorContext,
        });
      })
    );
  };

  return {
    debug: (msg, data) => {
      const context = { ...baseContext, ...data };
      send(logs.debug(APP_ID, msg, context), "debug", msg, context);
    },
    info: (msg, data) => {
      const context = { ...baseContext, ...data };
      send(logs.info(APP_ID, msg, context), "info", msg, context);
    },
    warn: (msg, data) => {
      const context = { ...baseContext, ...data };
      send(logs.warn(APP_ID, msg, context), "warn", msg, context);
    },
    error: (msg, data) => {
      const context = { ...baseContext, ...data };
      send(logs.error(APP_ID, msg, context), "error", msg, context);
    },
    child: (additionalContext) =>
      createLogger(logs, ctx, { ...baseContext, ...additionalContext }),
  };
}

/**
 * Per-category sample rates for high-volume routine INFO events.
 *
 * 5%: cache observability is a sanity tool, not an audit log. Operators can
 * raise to `1` (100%) temporarily while debugging an issue and roll back via
 * deploy.
 *
 * Anything not listed here defaults to 100%.
 */
const SAMPLE_RATES: Record<string, number> = {
  "cache.event": 0.05,
};

/**
 * Deterministic sampling helper for high-volume routine INFO events.
 *
 * Returns whether the event should be emitted given the category's sample
 * rate. Same `(category, key)` pair → same outcome → sampled streams stay
 * coherent across deploys/replays. Hashing is FNV-1a 32-bit on the joined
 * string; cheap and stable.
 *
 * WARN/ERROR/auth/payment-terminal events MUST NOT be sampled — those stay
 * at 100% and don't go through this helper.
 */
export function samplingFor(
  category: string,
  key: string
): { keep: boolean; rate: number } {
  const rate = SAMPLE_RATES[category] ?? 1;
  if (rate >= 1) return { keep: true, rate: 1 };
  // FNV-1a 32-bit
  let h = 0x811c9dc5;
  const s = `${category}:${key}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // unsigned >>> 0 maps int32 to uint32 so % 10000 is non-negative
  const bucket = (h >>> 0) % 10000;
  return { keep: bucket < Math.floor(rate * 10000), rate };
}
