import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: vi.fn(),
}));

vi.mock("@/lib/admin/auth", () => ({
  requireAdmin: vi.fn().mockResolvedValue(null),
}));

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireAdmin } from "@/lib/admin/auth";
import { GET, POST } from "../route";

const schedulerStub = {
  status: vi.fn().mockResolvedValue({ now: 123 }),
  refreshNow: vi.fn().mockResolvedValue({
    tenero: { succeeded: 1 },
    competition: { scanned: 1 },
  }),
  pauseUntil: vi.fn().mockResolvedValue(undefined),
  resume: vi.fn().mockResolvedValue(undefined),
};

const schedulerNamespace = {
  idFromName: vi.fn((name: string) => `id:${name}`),
  get: vi.fn(() => schedulerStub),
};

function request(path: string, method = "GET") {
  return new NextRequest(`https://aibtc.com${path}`, { method });
}

function mockCloudflareContext() {
  (getCloudflareContext as Mock).mockResolvedValue({
    env: { SCHEDULER: schedulerNamespace },
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
    expect(schedulerNamespace.idFromName).toHaveBeenCalledWith("v2");
    expect(body).toEqual({ name: "v2", status: { now: 123 } });
  });

  it("rejects unknown scheduler names before touching a stub", async () => {
    const response = await GET(request("/api/admin/scheduler?name=typo"));
    const body = (await response.json()) as any;

    expect(response.status).toBe(400);
    expect(body.error).toContain("Unsupported scheduler name");
    expect(schedulerNamespace.idFromName).not.toHaveBeenCalled();
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
    expect(schedulerStub.pauseUntil).not.toHaveBeenCalled();
  });

  it("rejects invalid refresh tasks", async () => {
    const response = await POST(
      request("/api/admin/scheduler?action=refresh&task=prices", "POST")
    );
    const body = (await response.json()) as any;

    expect(response.status).toBe(400);
    expect(body.error).toContain("Unsupported task");
    expect(schedulerStub.refreshNow).not.toHaveBeenCalled();
  });

  it("refreshes an allowlisted scheduler task", async () => {
    const response = await POST(
      request("/api/admin/scheduler?name=v3&action=refresh&task=all", "POST")
    );
    const body = (await response.json()) as any;

    expect(response.status).toBe(200);
    expect(schedulerNamespace.idFromName).toHaveBeenCalledWith("v3");
    expect(schedulerStub.refreshNow).toHaveBeenCalledWith("all");
    expect(body).toEqual({
      name: "v3",
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
    expect(schedulerStub.refreshNow).toHaveBeenCalledWith("competition");
    expect(body.task).toBe("competition");
  });
});
