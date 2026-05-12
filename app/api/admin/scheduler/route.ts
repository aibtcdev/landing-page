import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireAdmin } from "@/lib/admin/auth";
import type { SchedulerRpc, SchedulerTask } from "@/lib/scheduler/rpc-types";

const DEFAULT_SCHEDULER_INSTANCE = "v2";
const ALLOWED_SCHEDULER_INSTANCES = new Set(["v1", "v2", "v3"]);
const ALLOWED_TASKS = new Set<SchedulerTask>(["tenero", "all"]);

function json(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("X-Robots-Tag", "noindex");
  return NextResponse.json(body, { ...init, headers });
}

function schedulerName(url: URL): string | NextResponse {
  const name = url.searchParams.get("name") || DEFAULT_SCHEDULER_INSTANCE;
  if (!ALLOWED_SCHEDULER_INSTANCES.has(name)) {
    return json(
      { error: "Unsupported scheduler name. Use v1, v2, or v3." },
      { status: 400 }
    );
  }
  return name;
}

function schedulerStub(env: CloudflareEnv, name: string): SchedulerRpc {
  return env.SCHEDULER.get(env.SCHEDULER.idFromName(name));
}

function schedulerTask(url: URL): SchedulerTask | NextResponse {
  const task = url.searchParams.get("task") || "tenero";
  if (!ALLOWED_TASKS.has(task as SchedulerTask)) {
    return json(
      { error: "Unsupported task. Use tenero or all." },
      { status: 400 }
    );
  }
  return task as SchedulerTask;
}

export async function GET(request: NextRequest) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const { env } = await getCloudflareContext();
  const url = new URL(request.url);
  const name = schedulerName(url);
  if (typeof name !== "string") return name;

  const status = await schedulerStub(env, name).status();
  return json({ name, status });
}

export async function POST(request: NextRequest) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const { env } = await getCloudflareContext();
  const url = new URL(request.url);
  const name = schedulerName(url);
  if (typeof name !== "string") return name;

  const action = url.searchParams.get("action");
  const stub = schedulerStub(env, name);

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
    await stub.pauseUntil(until);
    return json({ name, pausedUntil: until });
  }

  if (action === "resume") {
    await stub.resume();
    return json({ name, resumed: true });
  }

  if (action === "refresh") {
    const task = schedulerTask(url);
    if (typeof task !== "string") return task;

    const result = await stub.refreshNow(task);
    return json({ name, task, result });
  }

  return json(
    { error: "Unsupported action. Use pause, resume, or refresh." },
    { status: 400 }
  );
}
