/**
 * Returns true when the binding should fail closed on error.
 * DEPLOY_ENV is set in production and preview; absent in local dev.
 */
export function shouldFailClosed(env: CloudflareEnv): boolean {
  return env.DEPLOY_ENV !== undefined;
}
