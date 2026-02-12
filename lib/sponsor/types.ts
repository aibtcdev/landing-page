/** Result of sponsor key provisioning attempt. */
export type SponsorKeyResult =
  | { success: true; apiKey: string }
  | { success: false; error: string; status?: number };
