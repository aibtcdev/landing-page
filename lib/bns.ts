/**
 * Look up the BNS (Bitcoin Naming Service) name for a Stacks address.
 */
export async function lookupBnsName(stxAddress: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://api.hiro.so/v1/addresses/stacks/${stxAddress}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { names?: string[] };
    return data.names?.[0] ?? null;
  } catch {
    return null;
  }
}
