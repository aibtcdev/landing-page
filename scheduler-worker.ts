/**
 * Standalone scheduler Worker (`aibtc-scheduler`).
 *
 * WHY THIS EXISTS: the `landing-page` Worker's cron trigger repeatedly gets
 * orphaned/stuck — every `wrangler deploy` re-applies the trigger and silently
 * stops dispatch (a verified Cloudflare cron fragility; a fresh worker's cron
 * fires fine on the same account). Hosting the scheduler in its own worker
 * gives it a cron that `landing-page` deploys can never disturb.
 *
 * IT IS THE SAME DATA: this worker binds the SAME D1 database
 * (`landing-page`) and the SAME KV namespaces (`VERIFIED_AGENTS`, `HOLDINGS_KV`)
 * that the site reads from. It just runs the existing `runScheduledTasks`
 * (Tenero prices + competition sweep + earnings) against those shared bindings —
 * the site (`landing-page`) keeps serving the UI/API and reads whatever this
 * worker writes. No data is duplicated; both workers point at one store.
 */

import { runScheduledTasks } from "./lib/scheduler/cron-runner";
import {
  createLogger,
  createConsoleLogger,
  isLogsRPC,
} from "./lib/logging";

export default {
  // A tiny fetch handler so the worker has an HTTP surface (health check).
  async fetch(): Promise<Response> {
    return new Response("aibtc-scheduler: cron-only worker. See Cron Triggers.", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  },

  async scheduled(
    event: ScheduledController,
    env: CloudflareEnv,
    ctx: ExecutionContext
  ): Promise<void> {
    const logger = isLogsRPC(env.LOGS)
      ? createLogger(env.LOGS, ctx, { path: "/__cron/scheduler", cron: event.cron })
      : createConsoleLogger({ path: "/__cron/scheduler", cron: event.cron });

    // Await directly (per the Cloudflare scheduled-handler docs) so any failure
    // is surfaced in Past Events with a real stack instead of being swallowed.
    try {
      await runScheduledTasks(env, logger);
    } catch (error) {
      console.error(
        "scheduler.cron_failed",
        error instanceof Error ? (error.stack ?? error.message) : String(error)
      );
      throw error;
    }
  },
};
