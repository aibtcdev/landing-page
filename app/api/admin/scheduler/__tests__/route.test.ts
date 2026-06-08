import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: vi.fn(),
}));

vi.mock("@/lib/admin/auth", () => ({
  requireAdmin: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/logging", () => ({
  isLogsRPC: vi.fn(() => false),
  createLogger: vi.fn(),
  createConsoleLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock("@/lib/scheduler/cron-runner", () => ({
  readSchedulerStatus: vi.fn().mockResolvedValue({ now: 123 }),
  refreshScheduler: vi.fn().mockResolvedValue({
    tenero: { succeeded: 1 },
    competition: { scanned: 1 },
  }),
  pauseScheduler: vi.fn().mockResolvedValue(undefined),
  resumeScheduler: vi.fn().mockResolvedValue(undefined),
}));

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireAdmin } from "@/lib/admin/auth";
import {
  readSchedulerStatus,
  refreshScheduler,
  pauseScheduler,
  resumeScheduler,
} from "@/lib/scheduler/cron-runner";
import { GET, POST } from "../route";

const kv = { get: vi.fn(), put: vi.fn(), delete: vi.fn() };

function request(path: string, method = "GET") {
  return new NextRequest(`https://aibtc.com${path}`, { method });
}

function mockCloudflareContext(env: Record<string, unknown> = { VERIFIED_AGENTS: kv }) {
  (getCloudflareContext as Mock).mockResolvedValue({
    env,
    ctx: { waitUntil: vi.fn(), passThroughOnException: vi.fn() },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  (requireAdmin as Mock).mockResolvedValue(null);
  mockCloudflareContext();
});

describe("GET /api/admin/scheduler", () => {
  it("requires admin auth", async () => {
    (requireAdmin as Mock).mockResolvedValueOnce(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    );

    const response = await GET(request("/api/admin/scheduler"));

    expect(response.status).toBe(401);
    expect(getCloudflareContext).not.toHaveBeenCalled();
  });

  it("returns scheduler status with no-store/noindex headers", async () => {
    const response = await GET(request("/api/admin/scheduler"));
    const body = (await response.json()) as any;

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex");
    expect(readSchedulerStatus).toHaveBeenCalledWith(kv);
    expect(body).toEqual({ status: { now: 123 } });
  });

  it("returns 503 when the KV state store is unavailable", async () => {
    mockCloudflareContext({});

    const response = await GET(request("/api/admin/scheduler"));
    const body = (await response.json()) as any;

    expect(response.status).toBe(503);
    expect(body.error).toContain("KV) unavailable");
    expect(readSchedulerStatus).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin/scheduler", () => {
  it("rejects pause without until", async () => {
    const response = await POST(
      request("/api/admin/scheduler?action=pause", "POST")
    );
    const body = (await response.json()) as any;

    expect(response.status).toBe(400);
    expect(body.error).toContain("Missing `until`");
    expect(pauseScheduler).not.toHaveBeenCalled();
  });

  it("pauses until a future timestamp", async () => {
    const until = Date.now() + 60_000;
    const response = await POST(
      request(`/api/admin/scheduler?action=pause&until=${until}`, "POST")
    );
    const body = (await response.json()) as any;

    expect(response.status).toBe(200);
    expect(pauseScheduler).toHaveBeenCalledWith(kv, until);
    expect(body).toEqual({ pausedUntil: until });
  });

  it("resumes the scheduler", async () => {
    const response = await POST(
      request("/api/admin/scheduler?action=resume", "POST")
    );
    const body = (await response.json()) as any;

    expect(response.status).toBe(200);
    expect(resumeScheduler).toHaveBeenCalledWith(kv);
    expect(body).toEqual({ resumed: true });
  });

  it("returns 503 on writes when the KV state store is unavailable", async () => {
    mockCloudflareContext({});

    const response = await POST(
      request("/api/admin/scheduler?action=refresh&task=all", "POST")
    );
    const body = (await response.json()) as any;

    expect(response.status).toBe(503);
    expect(body.error).toContain("KV) unavailable");
    expect(refreshScheduler).not.toHaveBeenCalled();
  });

  it("rejects invalid refresh tasks", async () => {
    const response = await POST(
      request("/api/admin/scheduler?action=refresh&task=prices", "POST")
    );
    const body = (await response.json()) as any;

    expect(response.status).toBe(400);
    expect(body.error).toContain("Unsupported task");
    expect(refreshScheduler).not.toHaveBeenCalled();
  });

  it("refreshes an allowlisted scheduler task", async () => {
    const response = await POST(
      request("/api/admin/scheduler?action=refresh&task=all", "POST")
    );
    const body = (await response.json()) as any;

    expect(response.status).toBe(200);
    expect(refreshScheduler).toHaveBeenCalledWith(
      expect.objectContaining({ VERIFIED_AGENTS: kv }),
      expect.anything(),
      "all"
    );
    expect(body).toEqual({
      task: "all",
      result: { tenero: { succeeded: 1 }, competition: { scanned: 1 } },
    });
  });

  it("refreshes the competition scheduler task", async () => {
    const response = await POST(
      request("/api/admin/scheduler?action=refresh&task=competition", "POST")
    );
    const body = (await response.json()) as any;

    expect(response.status).toBe(200);
    expect(refreshScheduler).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "competition"
    );
    expect(body.task).toBe("competition");
  });
});
