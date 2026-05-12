import type { TeneroRunResult } from "./tenero-task";

export type SchedulerTask = "tenero" | "all";

export interface SchedulerStatus {
  now: number;
  pausedUntil: number | null;
  lastTeneroRunAt: number | null;
  lastTeneroResult: TeneroRunResult | null;
  consecutiveFailures: { tenero: number };
  nextRunAfter: { tenero: number | null };
  nextAlarmAt: number | null;
}

export interface SchedulerRefreshResult {
  tenero?: TeneroRunResult;
}

export interface SchedulerRpc {
  status(): Promise<SchedulerStatus>;
  refreshNow(task: SchedulerTask): Promise<SchedulerRefreshResult>;
  pauseUntil(timestamp: number): Promise<void>;
  resume(): Promise<void>;
}
