import packageJson from "../../package.json";
import type { Logger } from "@/lib/logging";

export type PaymentEventName =
  | "payment.required"
  | "payment.accepted"
  | "payment.poll"
  | "payment.delivery_staged"
  | "payment.delivery_confirmed"
  | "payment.delivery_discarded"
  | "payment.retry_decision"
  | "payment.fallback_used";

export type PaymentLogLevel = "debug" | "info" | "warn" | "error";

export interface PaymentLogMetadata {
  route: string;
  paymentId?: string | null;
  status?: string | null;
  terminalReason?: string | null;
  action?: string | null;
  checkStatusUrl?: string | null;
  compatShimUsed?: boolean;
  additionalContext?: Record<string, unknown>;
}

export function getPaymentRepoVersion(env?: Record<string, unknown>): string {
  const deploySha =
    typeof env?.DEPLOY_SHA === "string" && env.DEPLOY_SHA.length > 0
      ? env.DEPLOY_SHA
      : typeof env?.CF_PAGES_COMMIT_SHA === "string" && env.CF_PAGES_COMMIT_SHA.length > 0
        ? env.CF_PAGES_COMMIT_SHA
        : undefined;

  return deploySha ?? packageJson.version;
}

export function buildPaymentLogContext(
  repoVersion: string,
  metadata: PaymentLogMetadata
): Record<string, unknown> {
  return {
    service: "landing-page",
    route: metadata.route,
    paymentId: metadata.paymentId ?? null,
    status: metadata.status ?? null,
    terminalReason: metadata.terminalReason ?? null,
    action: metadata.action ?? null,
    checkStatusUrl_present: Boolean(metadata.checkStatusUrl),
    compat_shim_used: metadata.compatShimUsed ?? false,
    repo_version: repoVersion,
    ...metadata.additionalContext,
  };
}

export function logPaymentEvent(
  logger: Logger,
  level: PaymentLogLevel,
  event: PaymentEventName,
  repoVersion: string,
  metadata: PaymentLogMetadata
): void {
  logger[level](event, buildPaymentLogContext(repoVersion, metadata));
}

export function summarizeRelayPollPayload(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object") {
    return {
      rawType: raw === null ? "null" : typeof raw,
    };
  }

  const record = raw as Record<string, unknown>;
  return {
    rawType: "object",
    rawKeys: Object.keys(record).sort(),
    rawStatus:
      typeof record.status === "string" ? record.status : null,
    rawPaymentId:
      typeof record.paymentId === "string" ? record.paymentId : null,
  };
}
