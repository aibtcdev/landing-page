export interface SubmittedStatusRecord {
  paymentId: string | null;
  status: "submitted";
}

export function collapseSubmittedStatus(
  raw: unknown,
  onSubmitted?: (record: SubmittedStatusRecord) => void
): unknown {
  if (
    raw &&
    typeof raw === "object" &&
    "status" in raw &&
    (raw as { status?: unknown }).status === "submitted"
  ) {
    const rawRecord = raw as Record<string, unknown>;
    onSubmitted?.({
      paymentId:
        typeof rawRecord.paymentId === "string" ? rawRecord.paymentId : null,
      status: "submitted",
    });
    return {
      ...raw,
      status: "queued",
    };
  }

  return raw;
}

export function selectCanonicalCheckStatusUrl(
  ...candidates: Array<string | undefined>
): string | undefined {
  return candidates.find(
    (candidate) => typeof candidate === "string" && candidate.length > 0
  );
}
