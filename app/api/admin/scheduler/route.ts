import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireAdmin } from "@/lib/admin/auth";

type SchedulerStub = {
  status(): Promise<unknown>;
  refreshNow(task: "tenero" | "all"): Promise<unknown>;
  pauseUntil(timestamp: number): Promise<void>;
  resume(): Promise<void>;
};

function schedulerStub(env: CloudflareEnv, name: string): SchedulerStub {
  const ns = env.SCHEDULER as unknown as {
    idFromName(name: string): DurableObjectId;
    get(id: DurableObjectId): SchedulerStub;
  };
  return ns.get(ns.idFromName(name));
}

export async function GET(request: NextRequest) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const { env } = await getCloudflareContext();
  const url = new URL(request.url);
  const name = url.searchParams.get("name") || "v2";
  const status = await schedulerStub(env, name).status();
  return NextResponse.json({ name, status });
}

export async function POST(request: NextRequest) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const { env } = await getCloudflareContext();
  const url = new URL(request.url);
  const name = url.searchParams.get("name") || "v2";
  const action = url.searchParams.get("action");
  const stub = schedulerStub(env, name);

  if (action === "pause") {
    const until = Number(url.searchParams.get("until") || 0);
    if (!Number.isFinite(until) || until <= Date.now()) {
      return NextResponse.json(
        { error: "Provide a future unix-millis `until` value." },
        { status: 400 }
      );
    }
    await stub.pauseUntil(until);
    return NextResponse.json({ name, pausedUntil: until });
  }

  if (action === "resume") {
    await stub.resume();
    return NextResponse.json({ name, resumed: true });
  }

  if (action === "refresh") {
    const task = url.searchParams.get("task") === "all" ? "all" : "tenero";
    const result = await stub.refreshNow(task);
    return NextResponse.json({ name, task, result });
  }

  return NextResponse.json(
    { error: "Unsupported action. Use pause, resume, or refresh." },
    { status: 400 }
  );
}
