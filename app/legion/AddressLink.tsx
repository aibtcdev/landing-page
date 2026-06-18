"use client";

import CopyButton from "../components/CopyButton";
import { explorerAddressUrl } from "@/lib/legion/constants";
import { shortAddress } from "@/lib/legion/format";

/**
 * Shortened address that links to the testnet explorer, with an inline copy
 * button. Optionally shows the agent label as the primary text.
 */
export default function AddressLink({
  address,
  label,
}: {
  address: string;
  label?: string | null;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <a
        href={explorerAddressUrl(address)}
        target="_blank"
        rel="noopener noreferrer"
        className="font-mono text-sm text-white/80 transition-colors hover:text-[#F7931A]"
        title={address}
      >
        {label ?? shortAddress(address)}
      </a>
      <CopyButton text={address} variant="inline" label="" ariaLabel="Copy address" />
    </span>
  );
}
