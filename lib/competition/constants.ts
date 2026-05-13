/**
 * Competition campaign start (Unix epoch seconds, UTC).
 *
 * Trades with `burn_block_time < COMP_START_TIMESTAMP` are rejected by the
 * verifier (code: `before_comp_start`) even if otherwise valid — they
 * pre-date the campaign window. This is a hard correctness gate so that
 * neither the agent-submit fast path nor the scheduler catch-up pass can
 * pollute `swaps` with pre-campaign history.
 *
 * 1778630400 = 2026-05-13T00:00:00Z.
 *
 * To shift the start, update this constant and re-deploy. If we ever need
 * separate preview vs prod values, promote to an env-var read from the
 * worker bindings.
 */
export const COMP_START_TIMESTAMP = 1778630400;
