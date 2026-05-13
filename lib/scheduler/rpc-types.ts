import type { TeneroRunResult } from "./tenero-task";
import type { CompetitionSchedulerSummary } from "../competition/scheduler";

export type SchedulerTask = "tenero" | "competition" | "all";

export interface SchedulerStatus {
  now: number;
  pausedUntil: number | null;
  lastTeneroRunAt: number | null;
  lastTeneroResult: TeneroRunResult | null;
  lastCompetitionRunAt: number | null;
  lastCompetitionResult: CompetitionSchedulerSummary | null;
  consecutiveFailures: { tenero: number; competition: number };
  nextRunAfter: { tenero: number | null; competition: number | null };
  nextAlarmAt: number | null;
}

export interface SchedulerRefreshResult {
  tenero?: TeneroRunResult;
  competition?: CompetitionSchedulerSummary;
}

export interface SchedulerRpc {
  status(): Promise<SchedulerStatus>;
  refreshNow(task: SchedulerTask): Promise<SchedulerRefreshResult>;
  pauseUntil(timestamp: number): Promise<void>;
  resume(): Promise<void>;
}
