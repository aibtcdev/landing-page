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
        console.error(`[logger] Failed to send ${level} log: ${err}`);
        console.error(`[logger] Original message: ${message}`, context);
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
