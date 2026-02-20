/** The project's X handle, with @ prefix. */
export const X_HANDLE = "@aibtcdev";

/** Base URL for bitcoinfaces.xyz avatar images. */
export const AVATAR_URL_BASE = "https://bitcoinfaces.xyz/api/get-image";

/** Returns the avatar URL for a given Bitcoin address or name string. */
export function getAvatarUrl(nameOrAddress: string): string {
  return `${AVATAR_URL_BASE}?name=${encodeURIComponent(nameOrAddress)}`;
}
