import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireAdmin } from "@/lib/admin/auth";
import { isPartialAgentRecord } from "@/lib/types";

// ── Types ──────────────────────────────────────────────────────────────────

/**
 * Required fields that backfill checks after the isPartialAgentRecord guard.
 * A record that passes `isPartialAgentRecord` is already excluded from D1;
 * these are records that *failed* isPartialAgentRecord (i.e., have at least one
 * Stacks credential) but are still missing one or more of these four required
 * fields.
 */
const REQUIRED_FIELDS = [
  "stxAddress",
  "stxPublicKey",
  "btcPublicKey",
  "verifiedAt",
] as const;
type RequiredField = (typeof REQUIRED_FIELDS)[number];

/**
 * Optional "marker" fields that indicate richer registration state.
 * Presence/absence is noted for each record — useful for diagnosing
 * which partial-repair path makes sense.
 */
const MARKER_FIELDS = [
  "stxAddress",
  "stxPublicKey",
  "btcPublicKey",
  "btcAddress",
  "taprootAddress",
  "displayName",
  "description",
  "verifiedAt",
  "lastActiveAt",
  "erc8004AgentId",
  "nostrPublicKey",
  "referredBy",
] as const;
type MarkerField = (typeof MARKER_FIELDS)[number];

/**
 * Classification of an invalid KV record into a tentative bucket.
 *
 * These are TENTATIVE suggestions based on field-presence patterns only.
 * whoabuddy makes the final bucket assignment in Step 2.
 *
 * - "repairable"        — Missing only one required field; likely can be
 *                          repaired if the missing value can be recovered
 *                          (e.g., from a stx: twin record).
 * - "retired"           — Missing multiple required fields but has some
 *                          recognisable structure (btcAddress present). These
 *                          may represent abandoned or interrupted registrations.
 * - "schema-unfixable"  — Missing btcAddress or otherwise malformed. No safe
 *                          repair path exists; archival is likely the only option.
 */
type TentativeBucket = "repairable" | "retired" | "schema-unfixable";

export interface InvalidAgentEntry {
  kv_key: string;
  btc_address: string | null;
  /** Fields present in the KV record (from MARKER_FIELDS list) */
  present_fields: MarkerField[];
  /** Required fields that are missing */
  missing_required_fields: RequiredField[];
  /**
   * Count of missing required fields (0 means the record passed strict
   * validation and should NOT appear in this report — sanity check only).
   */
  missing_required_count: number;
  /** Why the record was rejected: "partial" means isPartialAgentRecord returned true */
  rejection_reason: "partial" | "missing_required_fields" | "json_parse_error";
  tentative_bucket: TentativeBucket;
  /**
   * Step 1.5 stx: twin fields — READ-ONLY lookups to inform Step 2 repair-source decision.
   * Only populated when the btc: record carries a non-empty stxAddress.
   * null means the btc: record has no stxAddress, so no twin key to look up.
   */
  /** Whether the stx:{stxAddress} twin key exists in KV */
  stx_twin_present: boolean | null;
  /**
   * Whether the stx: twin record carries a non-empty btcPublicKey string.
   * null when stx_twin_present is false or null.
   */
  stx_twin_has_btcpubkey: boolean | null;
  /**
   * First 8 characters of the twin's btcPublicKey for sanity-checking format.
   * Compressed pubkeys start with "02" or "03"; uncompressed start with "04".
   * null when stx_twin_has_btcpubkey is false or null.
   */
  stx_twin_btcpubkey_value_preview: string | null;
}

interface FieldMissingnessFrequency {
  field: RequiredField;
  count: number;
  percent_of_invalid: string;
}

interface MissingFieldPattern {
  pattern: string; // comma-joined sorted field names
  count: number;
  percent_of_invalid: string;
  tentative_bucket: TentativeBucket;
}

interface StxTwinAggregate {
  /**
   * Count of invalid records that have a non-null stxAddress
   * (i.e., records for which a stx: twin lookup was attempted).
   */
  records_with_stx_address: number;
  /**
   * Count of records whose stx:{stxAddress} twin key exists in KV.
   * Step 2 load-bearing number: if this equals records_with_stx_address,
   * all repairable records have a twin to copy btcPublicKey from.
   */
  stx_twin_present_count: number;
  /**
   * Count of records whose stx: twin carries a non-empty btcPublicKey.
   * This is the key Step 2 decision number: if equal to stx_twin_present_count,
   * repair is a single-pass copy from the twin record.
   */
  stx_twin_has_btcpubkey_count: number;
  /** Count of records where the stx: twin is present but missing btcPublicKey */
  stx_twin_missing_btcpubkey_count: number;
  /** btcPublicKey format breakdown based on 8-char preview prefix */
  btcpubkey_format_breakdown: {
    compressed_02: number; // starts with "02" — compressed secp256k1
    compressed_03: number; // starts with "03" — compressed secp256k1
    uncompressed_04: number; // starts with "04" — uncompressed secp256k1
    other: number; // any other prefix (unexpected)
  };
}

interface AuditReport {
  generated_at: string;
  total_btc_keys_scanned: number;
  /** Records that passed both guards and are in D1 (excluded from this report) */
  valid_count: number;
  /** Records caught by isPartialAgentRecord guard */
  partial_count: number;
  /**
   * Records that failed isPartialAgentRecord but have missing required fields.
   * This is the core #691 population.
   */
  invalid_required_fields_count: number;
  /** Records that failed JSON.parse */
  json_parse_error_count: number;
  /** Total invalid records (partial + invalid_required_fields + json_parse) */
  total_invalid_count: number;
  aggregate_buckets: {
    repairable: number;
    retired: number;
    "schema-unfixable": number;
  };
  missing_field_frequency: FieldMissingnessFrequency[];
  missing_field_patterns: MissingFieldPattern[];
  /** Records grouped by how many required fields are missing */
  missing_count_histogram: Record<string, number>;
  /** Step 1.5: stx: twin presence + btcPublicKey check aggregate stats */
  stx_twin_aggregate: StxTwinAggregate;
  records: InvalidAgentEntry[];
  /** Pagination cursor; null when scan complete */
  cursor: string | null;
  duration_ms: number;
}

// ── Classification logic ──────────────────────────────────────────────────

/**
 * Classify an invalid record into a tentative bucket.
 *
 * Rules (field-presence only — no on-chain checks):
 *   - schema-unfixable: btcAddress is missing or not a string (can't key the record)
 *   - repairable:       exactly 1 required field missing
 *   - retired:          2+ required fields missing but btcAddress is present
 */
function classifyBucket(
  btcAddress: string | null,
  missingRequired: RequiredField[]
): TentativeBucket {
  if (!btcAddress) return "schema-unfixable";
  if (missingRequired.length === 1) return "repairable";
  return "retired";
}

/**
 * Build an InvalidAgentEntry for a record that failed strict validation.
 *
 * The stx_twin_* fields are initialised to null here and filled in by
 * the scan loop after the parallel stx: twin kv.get calls complete.
 */
function buildEntry(
  kvKey: string,
  raw: string | null,
  rejectionReason: InvalidAgentEntry["rejection_reason"],
  parsed: Record<string, unknown> | null
): InvalidAgentEntry {
  if (rejectionReason === "json_parse_error" || !parsed) {
    return {
      kv_key: kvKey,
      btc_address: null,
      present_fields: [],
      missing_required_fields: [...REQUIRED_FIELDS],
      missing_required_count: REQUIRED_FIELDS.length,
      rejection_reason: "json_parse_error",
      tentative_bucket: "schema-unfixable",
      stx_twin_present: null,
      stx_twin_has_btcpubkey: null,
      stx_twin_btcpubkey_value_preview: null,
    };
  }

  const btcAddress =
    typeof parsed.btcAddress === "string" && parsed.btcAddress
      ? parsed.btcAddress
      : null;

  // Determine which marker fields are present (non-null, non-empty)
  const presentFields: MarkerField[] = MARKER_FIELDS.filter((f) => {
    const val = parsed[f];
    return val !== undefined && val !== null && val !== "";
  });

  // Determine which required fields are missing
  const missingRequired: RequiredField[] = REQUIRED_FIELDS.filter((f) => {
    const val = parsed[f];
    return typeof val !== "string" || !val;
  });

  return {
    kv_key: kvKey,
    btc_address: btcAddress,
    present_fields: presentFields,
    missing_required_fields: missingRequired,
    missing_required_count: missingRequired.length,
    rejection_reason: rejectionReason,
    tentative_bucket: classifyBucket(btcAddress, missingRequired),
    // stx_twin_* fields are populated by the scan loop after the twin kv.get calls
    stx_twin_present: null,
    stx_twin_has_btcpubkey: null,
    stx_twin_btcpubkey_value_preview: null,
  };
}

/**
 * Extract the stxAddress string from a parsed record if present and non-empty.
 */
function extractStxAddress(parsed: Record<string, unknown>): string | null {
  const val = parsed["stxAddress"];
  return typeof val === "string" && val ? val : null;
}

/**
 * Classify a stx: twin's btcPublicKey into a format category based on its 2-char prefix.
 */
function classifyBtcPubkeyFormat(
  preview: string
): keyof StxTwinAggregate["btcpubkey_format_breakdown"] {
  if (preview.startsWith("02")) return "compressed_02";
  if (preview.startsWith("03")) return "compressed_03";
  if (preview.startsWith("04")) return "uncompressed_04";
  return "other";
}

// ── Audit scan ────────────────────────────────────────────────────────────

/**
 * Scan `btc:` KV prefix and collect all records that fail strict validation.
 *
 * For each invalid record that carries a stxAddress, also fetches the stx:
 * twin record (READ-ONLY) to determine whether the twin has a btcPublicKey.
 * This is the Step 1.5 data needed to decide whether repair is a single-pass
 * copy from the twin (Step 2 design decision).
 *
 * Reads values in parallel batches of 50 (mirrors the reconcile route pattern).
 * Pagination is cursor-based for large datasets (expected ~1664 btc: keys).
 *
 * Subrequest budget per call at batchSize=200:
 *   - 1      kv.list
 *   - ~200   kv.get for btc: values (parallel batches of 50)
 *   - ≤200   kv.get for stx: twin values (only invalid records with stxAddress;
 *             fetched after Phase 1 in batches of 50)
 *   Total: ~401 — still well under the Workers 1000-subrequest cap.
 *
 * Returns the entries plus a next cursor (null when scan complete).
 */
async function scanInvalidAgents(
  kv: KVNamespace,
  batchSize: number,
  cursor: string | null
): Promise<{
  entries: InvalidAgentEntry[];
  validCount: number;
  nextCursor: string | null;
}> {
  const entries: InvalidAgentEntry[] = [];
  let validCount = 0;

  const listOpts: KVNamespaceListOptions = { prefix: "btc:", limit: batchSize };
  if (cursor) listOpts.cursor = cursor;

  const page = await kv.list(listOpts);

  // Phase 1: Classify btc: records in parallel batches of 50.
  // Also collect (entryIndex → stxAddress) pairs for Phase 2 twin lookups.
  const FETCH_BATCH = 50;
  // Maps entry index (position in entries[]) to the stxAddress string for twin lookup
  const twinLookupMap = new Map<number, string>(); // entryIndex → stxAddress

  for (let i = 0; i < page.keys.length; i += FETCH_BATCH) {
    const batch = page.keys.slice(i, i + FETCH_BATCH);
    const values = await Promise.all(batch.map((k) => kv.get(k.name)));

    for (let j = 0; j < batch.length; j++) {
      const kvKey = batch[j].name;
      const raw = values[j];

      if (!raw) {
        // Key listed but value missing — treat as json_parse_error
        entries.push(buildEntry(kvKey, null, "json_parse_error", null));
        continue;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        entries.push(buildEntry(kvKey, raw, "json_parse_error", null));
        continue;
      }

      // Guard 1: isPartialAgentRecord (matches backfill's skip logic)
      if (isPartialAgentRecord(parsed)) {
        const rec = parsed as unknown as Record<string, unknown>;
        const entryIdx = entries.length;
        entries.push(buildEntry(kvKey, raw, "partial", rec));
        // Partial records may still carry stxAddress — check for twin
        const stxAddr = extractStxAddress(rec);
        if (stxAddr) twinLookupMap.set(entryIdx, stxAddr);
        continue;
      }

      // Guard 2: strict required-field check (matches backfill's second rejection)
      const rec = parsed as Record<string, unknown>;
      const missingRequired: RequiredField[] = REQUIRED_FIELDS.filter((f) => {
        const val = rec[f];
        return typeof val !== "string" || !val;
      });

      if (missingRequired.length > 0) {
        const entryIdx = entries.length;
        entries.push(buildEntry(kvKey, raw, "missing_required_fields", rec));
        // These records have stxAddress in present_fields if the field is present
        const stxAddr = extractStxAddress(rec);
        if (stxAddr) twinLookupMap.set(entryIdx, stxAddr);
        continue;
      }

      // Passed both guards — valid record (in D1)
      validCount++;
    }
  }

  // Phase 2: Fetch stx: twin records for all entries that have a stxAddress.
  // Execute in batches of 50 to mirror Phase 1's subrequest pattern.
  if (twinLookupMap.size > 0) {
    const twinEntries = Array.from(twinLookupMap.entries()); // [entryIdx, stxAddress]

    for (let i = 0; i < twinEntries.length; i += FETCH_BATCH) {
      const twinBatch = twinEntries.slice(i, i + FETCH_BATCH);
      const twinValues = await Promise.all(
        twinBatch.map(([, stxAddr]) => kv.get(`stx:${stxAddr}`))
      );

      for (let j = 0; j < twinBatch.length; j++) {
        const [entryIdx] = twinBatch[j];
        const twinRaw = twinValues[j];
        const entry = entries[entryIdx];

        if (!twinRaw) {
          // stx: key doesn't exist at all
          entry.stx_twin_present = false;
          entry.stx_twin_has_btcpubkey = null;
          entry.stx_twin_btcpubkey_value_preview = null;
          continue;
        }

        entry.stx_twin_present = true;

        let twinParsed: unknown;
        try {
          twinParsed = JSON.parse(twinRaw);
        } catch {
          // twin exists but is not valid JSON — treat as no btcPublicKey
          entry.stx_twin_has_btcpubkey = false;
          entry.stx_twin_btcpubkey_value_preview = null;
          continue;
        }

        const twin = twinParsed as Record<string, unknown>;
        const twinBtcPubkey = twin["btcPublicKey"];
        if (typeof twinBtcPubkey === "string" && twinBtcPubkey) {
          entry.stx_twin_has_btcpubkey = true;
          // Only store the first 8 chars — enough to verify 02/03/04 prefix + 3 more hex chars
          entry.stx_twin_btcpubkey_value_preview = twinBtcPubkey.slice(0, 8);
        } else {
          entry.stx_twin_has_btcpubkey = false;
          entry.stx_twin_btcpubkey_value_preview = null;
        }
      }
    }
  }

  return {
    entries,
    validCount,
    nextCursor: page.list_complete ? null : (page.cursor ?? null),
  };
}

// ── Aggregate stats ───────────────────────────────────────────────────────

function computeAggregates(records: InvalidAgentEntry[]): {
  aggregate_buckets: AuditReport["aggregate_buckets"];
  missing_field_frequency: FieldMissingnessFrequency[];
  missing_field_patterns: MissingFieldPattern[];
  missing_count_histogram: Record<string, number>;
  stx_twin_aggregate: StxTwinAggregate;
} {
  const buckets: AuditReport["aggregate_buckets"] = {
    repairable: 0,
    retired: 0,
    "schema-unfixable": 0,
  };

  const fieldCounts: Record<RequiredField, number> = {
    stxAddress: 0,
    stxPublicKey: 0,
    btcPublicKey: 0,
    verifiedAt: 0,
  };

  const patternMap = new Map<string, { count: number; bucket: TentativeBucket }>();
  const histogram: Record<string, number> = {};

  const stxTwin: StxTwinAggregate = {
    records_with_stx_address: 0,
    stx_twin_present_count: 0,
    stx_twin_has_btcpubkey_count: 0,
    stx_twin_missing_btcpubkey_count: 0,
    btcpubkey_format_breakdown: {
      compressed_02: 0,
      compressed_03: 0,
      uncompressed_04: 0,
      other: 0,
    },
  };

  for (const rec of records) {
    buckets[rec.tentative_bucket]++;

    for (const f of rec.missing_required_fields) {
      fieldCounts[f]++;
    }

    const patternKey = rec.missing_required_fields.slice().sort().join(",") || "(none)";
    const existing = patternMap.get(patternKey);
    if (existing) {
      existing.count++;
    } else {
      patternMap.set(patternKey, { count: 1, bucket: rec.tentative_bucket });
    }

    const countKey = String(rec.missing_required_count);
    histogram[countKey] = (histogram[countKey] ?? 0) + 1;

    // stx_twin_aggregate: tally records that had a stx: twin lookup attempted
    if (rec.stx_twin_present !== null) {
      stxTwin.records_with_stx_address++;
      if (rec.stx_twin_present) {
        stxTwin.stx_twin_present_count++;
        if (rec.stx_twin_has_btcpubkey) {
          stxTwin.stx_twin_has_btcpubkey_count++;
          if (rec.stx_twin_btcpubkey_value_preview) {
            const fmt = classifyBtcPubkeyFormat(rec.stx_twin_btcpubkey_value_preview);
            stxTwin.btcpubkey_format_breakdown[fmt]++;
          }
        } else {
          stxTwin.stx_twin_missing_btcpubkey_count++;
        }
      }
    }
  }

  const total = records.length;
  const missing_field_frequency: FieldMissingnessFrequency[] = REQUIRED_FIELDS.map((f) => ({
    field: f,
    count: fieldCounts[f],
    percent_of_invalid: total > 0 ? ((fieldCounts[f] / total) * 100).toFixed(1) + "%" : "0%",
  })).sort((a, b) => b.count - a.count);

  const missing_field_patterns: MissingFieldPattern[] = Array.from(
    patternMap.entries()
  )
    .map(([pattern, { count, bucket }]) => ({
      pattern,
      count,
      percent_of_invalid:
        total > 0 ? ((count / total) * 100).toFixed(1) + "%" : "0%",
      tentative_bucket: bucket,
    }))
    .sort((a, b) => b.count - a.count);

  return {
    aggregate_buckets: buckets,
    missing_field_frequency,
    missing_field_patterns,
    missing_count_histogram: histogram,
    stx_twin_aggregate: stxTwin,
  };
}

// ── Route handlers ─────────────────────────────────────────────────────────

/**
 * GET /api/admin/audit-invalid-agents
 *
 * Self-documenting description. Requires X-Admin-Key.
 */
export async function GET(request: NextRequest) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  return NextResponse.json({
    endpoint: "/api/admin/audit-invalid-agents",
    description:
      "Step 1.5 of issue #691: stx: twin btcPublicKey check — read-only extension of the Step 1 inventory. " +
      "Scans all btc: keys, applies the same two-step rejection as the backfill route " +
      "(isPartialAgentRecord guard + strict required-field check), and for each invalid record " +
      "with a stxAddress, fetches the stx:{stxAddress} twin record to check whether it carries " +
      "a btcPublicKey. The stx_twin_aggregate.stx_twin_has_btcpubkey_count is the load-bearing " +
      "number for the Step 2 design decision: if it equals records_with_stx_address, repair is " +
      "a single-pass copy from the twin. READ-ONLY — no writes to KV, D1, or any other storage.",
    authentication: "Requires X-Admin-Key header",
    methods: ["GET", "POST"],
    queryParams: {
      batchSize:
        "KV page size per POST call: 10–500 (default: 200). Each call fetches one page of btc: keys.",
      cursor:
        "Resume cursor from prior POST response. Absent = first call. Accumulate `records` across calls.",
    },
    tentative_bucket_definitions: {
      repairable:
        "Missing exactly 1 required field. May be repairable if the missing value can be recovered " +
        "(e.g., from the stx: twin record or on-chain lookup). whoabuddy confirms in Step 2.",
      retired:
        "Missing 2+ required fields but btcAddress is present. Likely an abandoned or interrupted " +
        "registration. Archival is the probable path.",
      "schema-unfixable":
        "Missing btcAddress or failed JSON parse. No safe repair path.",
    },
    required_fields_checked: REQUIRED_FIELDS,
    marker_fields_reported: MARKER_FIELDS,
    pagination: {
      note: "Use cursor to paginate across all btc: keys (~1664 expected). Accumulate records client-side.",
      example: `cursor=""
while :; do
  payload=$(jq -nc --arg c "$cursor" '{cursor: $c}')
  resp=$(curl -sS -X POST "https://aibtc.com/api/admin/audit-invalid-agents?batchSize=200" \\
    -H "X-Admin-Key: $KEY" \\
    -H "Content-Type: application/json" \\
    -d "$payload")
  cursor=$(echo "$resp" | jq -r '.cursor // empty')
  [ -z "$cursor" ] && break
done`,
    },
    response: {
      total_btc_keys_scanned: "Total btc: keys processed in this call",
      valid_count: "Records that passed strict validation (in D1)",
      partial_count: "Records caught by isPartialAgentRecord guard",
      invalid_required_fields_count: "Records with missing required fields (core #691 population)",
      json_parse_error_count: "Records that failed JSON.parse",
      total_invalid_count: "Sum of partial + invalid_required_fields + json_parse",
      aggregate_buckets: "Tentative bucket counts: repairable / retired / schema-unfixable",
      missing_field_frequency: "Per-field count of how often each required field is missing",
      missing_field_patterns: "Distinct combinations of missing fields, sorted by frequency",
      missing_count_histogram: "Distribution of records by missing-field count",
      stx_twin_aggregate: {
        records_with_stx_address: "Invalid records that have a non-null stxAddress (twin lookup was attempted)",
        stx_twin_present_count: "Records whose stx:{stxAddress} twin key exists in KV",
        stx_twin_has_btcpubkey_count: "LOAD-BEARING: Records whose twin carries a non-empty btcPublicKey. If equal to records_with_stx_address, repair is a single-pass copy.",
        stx_twin_missing_btcpubkey_count: "Records where the twin exists but lacks btcPublicKey",
        btcpubkey_format_breakdown: "Format distribution of twin btcPublicKey values (02/03 = compressed, 04 = uncompressed, other = unexpected)",
      },
      records: "Per-record detail array (each includes stx_twin_present, stx_twin_has_btcpubkey, stx_twin_btcpubkey_value_preview)",
      cursor: "Resume cursor; null when scan complete",
      duration_ms: "Wall-clock milliseconds for this call",
    },
    step_gate:
      "This route implements Step 1.5 (stx: twin check — read-only extension of Step 1). " +
      "Steps 2–5 (bucket assignment, repair, archive, fallback removal) require explicit user sign-off " +
      "because they involve production writes/deletes affecting live agents.",
  });
}

/**
 * POST /api/admin/audit-invalid-agents
 *
 * Run one page of the invalid-agent inventory scan (Step 1.5: stx: twin check).
 *
 * Body: { cursor?: string } — resume cursor from prior response.
 * Query params:
 *   - batchSize: 10–500 (default: 200)
 *
 * Returns an AuditReport for the scanned page. Caller accumulates `records`
 * across pages and re-runs aggregates on the full dataset at the end.
 *
 * Subrequest budget per call at batchSize=200:
 *   - 1      kv.list
 *   - ~200   kv.get for btc: values (parallel batches of 50)
 *   - ≤200   kv.get for stx: twin values (only invalid records with stxAddress)
 *   Total: ~401 — well under the Workers 1000-subrequest cap.
 */
export async function POST(request: NextRequest) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const start = Date.now();

  const { env } = await getCloudflareContext();
  const kv = env.VERIFIED_AGENTS as KVNamespace;

  const { searchParams } = new URL(request.url);
  const rawBatchSize = searchParams.get("batchSize");
  let batchSize = rawBatchSize ? parseInt(rawBatchSize, 10) : 200;
  if (!Number.isFinite(batchSize)) batchSize = 200;
  batchSize = Math.max(10, Math.min(500, batchSize));

  // Cursor in POST body (avoids URL length issues if cursor grows large)
  const body = await request.json().catch(() => ({}));
  const cursor = (body as { cursor?: string }).cursor ?? null;

  try {
    const { entries, validCount, nextCursor } = await scanInvalidAgents(
      kv,
      batchSize,
      cursor || null
    );

    const partialCount = entries.filter((e) => e.rejection_reason === "partial").length;
    const invalidRequiredCount = entries.filter(
      (e) => e.rejection_reason === "missing_required_fields"
    ).length;
    const jsonParseErrorCount = entries.filter(
      (e) => e.rejection_reason === "json_parse_error"
    ).length;

    const aggregates = computeAggregates(entries);

    const report: AuditReport = {
      generated_at: new Date().toISOString(),
      total_btc_keys_scanned: entries.length + validCount,
      valid_count: validCount,
      partial_count: partialCount,
      invalid_required_fields_count: invalidRequiredCount,
      json_parse_error_count: jsonParseErrorCount,
      total_invalid_count: entries.length,
      aggregate_buckets: aggregates.aggregate_buckets,
      missing_field_frequency: aggregates.missing_field_frequency,
      missing_field_patterns: aggregates.missing_field_patterns,
      missing_count_histogram: aggregates.missing_count_histogram,
      stx_twin_aggregate: aggregates.stx_twin_aggregate,
      records: entries,
      cursor: nextCursor,
      duration_ms: Date.now() - start,
    };

    return NextResponse.json(report);
  } catch (e) {
    return NextResponse.json(
      {
        error: `Audit scan failed: ${(e as Error).message}`,
        duration_ms: Date.now() - start,
      },
      { status: 500 }
    );
  }
}
