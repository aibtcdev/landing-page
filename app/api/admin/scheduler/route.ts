import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireAdmin } from "@/lib/admin/auth";
import { createConsoleLogger, createLogger, isLogsRPC } from "@/lib/logging";
import {
  readSchedulerStatus,
  refreshScheduler,
  pauseScheduler,
  resumeScheduler,
} from "@/lib/scheduler/cron-runner";
import type { SchedulerTask } from "@/lib/scheduler/rpc-types";

const ALLOWED_TASKS = new Set<SchedulerTask>(["tenero", "competition", "all"]);

function json(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("X-Robots-Tag", "noindex");
  return NextResponse.json(body, { ...init, headers });
}

function requireKv(env: CloudflareEnv): NextResponse | null {
  if (env.VERIFIED_AGENTS) return null;
  return json(
    { error: "Scheduler state store (KV) unavailable in this environment." },
    { status: 503 }
  );
}

function schedulerTask(url: URL): SchedulerTask | NextResponse {
  const task = url.searchParams.get("task") || "tenero";
  if (!ALLOWED_TASKS.has(task as SchedulerTask)) {
    return json(
      { error: "Unsupported task. Use tenero, competition, or all." },
      { status: 400 }
    );
  }
  return task as SchedulerTask;
}

export async function GET(request: NextRequest) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const { env } = await getCloudflareContext();
  const missingKv = requireKv(env);
  if (missingKv) return missingKv;

  const status = await readSchedulerStatus(env.VERIFIED_AGENTS);
  return json({ status });
}

export async function POST(request: NextRequest) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const { env, ctx } = await getCloudflareContext();
  const missingKv = requireKv(env);
  if (missingKv) return missingKv;

  const url = new URL(request.url);
  const action = url.searchParams.get("action");

  if (action === "pause") {
    const rawUntil = url.searchParams.get("until");
    if (!rawUntil) {
      return json(
        { error: "Missing `until`; provide a future unix-millis value." },
        { status: 400 }
      );
    }

    const until = Number(rawUntil);
    if (!Number.isFinite(until) || until <= Date.now()) {
      return json(
        { error: "Provide a future unix-millis `until` value." },
        { status: 400 }
      );
    }
    await pauseScheduler(env.VERIFIED_AGENTS, until);
    return json({ pausedUntil: until });
  }

  if (action === "resume") {
    await resumeScheduler(env.VERIFIED_AGENTS);
    return json({ resumed: true });
  }

  if (action === "refresh") {
    const task = schedulerTask(url);
    if (typeof task !== "string") return task;

    const logger = isLogsRPC(env.LOGS)
      ? createLogger(env.LOGS, ctx, { path: "/api/admin/scheduler", action: "refresh", task })
      : createConsoleLogger({ path: "/api/admin/scheduler", action: "refresh", task });

    const result = await refreshScheduler(env, logger, task);
    return json({ task, result });
  }

  return json(
    { error: "Unsupported action. Use pause, resume, or refresh." },
    { status: 400 }
  );
}
