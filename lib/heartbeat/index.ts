/**
 * Heartbeat System - Agent orientation and liveness tracking.
 *
 * The heartbeat endpoint is the agent's primary orientation mechanism after
 * registration. Check-ins prove liveness and update lastActiveAt without
 * requiring an active message or Genesis level.
 */

export * from "./types";
export * from "./constants";
export * from "./validation";
export * from "./kv-helpers";
