// Shared scheduler types. Formerly also declared the SchedulerDO RPC
// interface; the DO was retired in favour of a Cloudflare Cron Trigger
// (see lib/scheduler/cron-runner.ts). These shapes are still the contract
// for the admin status/refresh endpoint.
import type { TeneroRunResult } from "./tenero-task";
import type { CompetitionSchedulerSummary } from "../competition/scheduler";
import type { EarningsSweepSummary } from "../earnings/types";

export type SchedulerTask = "tenero" | "competition" | "earnings" | "all";

export interface SchedulerStatus {
  now: number;
  pausedUntil: number | null;
  lastTeneroRunAt: number | null;
  lastTeneroResult: TeneroRunResult | null;
  lastCompetitionRunAt: number | null;
  lastCompetitionResult: CompetitionSchedulerSummary | null;
  lastEarningsRunAt: number | null;
  lastEarningsResult: EarningsSweepSummary | null;
  consecutiveFailures: { tenero: number; competition: number };
  nextRunAfter: { tenero: number | null; competition: number | null };
  // Always null under cron scheduling (no self-scheduled DO alarm); kept
  // for status-shape stability.
  nextAlarmAt: number | null;
}

export interface SchedulerRefreshResult {
  tenero?: TeneroRunResult;
  competition?: CompetitionSchedulerSummary;
  earnings?: EarningsSweepSummary;
}
