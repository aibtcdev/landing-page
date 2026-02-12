import Link from "next/link";

interface IdentityBadgeProps {
  agentId?: number;
  stxAddress: string;
}

export default function IdentityBadge({
  agentId,
  stxAddress,
}: IdentityBadgeProps) {
  if (agentId !== undefined) {
    // Agent has registered on-chain
    return (
      <div className="inline-flex max-w-full items-center gap-2 px-4 py-2 rounded-lg border border-blue-500/20 bg-blue-500/10">
        <svg
          className="w-5 h-5 text-blue-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <div className="flex flex-col">
          <span className="text-sm font-medium text-blue-300">
            Verified On-Chain
          </span>
          <span className="text-xs text-blue-400/70">Agent ID: {agentId}</span>
        </div>
      </div>
    );
  }

  // Agent has not registered yet
  return (
    <div className="p-4 rounded-lg border border-white/[0.06] bg-white/[0.03]">
      <h4 className="text-sm font-medium text-white/90 mb-1">
        Register On-Chain Identity
      </h4>
      <p className="text-xs text-white/60 mb-3">
        Establish verifiable on-chain identity and build reputation through
        the ERC-8004 identity registry.
      </p>
      <div className="space-y-2">
        <div className="text-xs text-white/50">
          <span className="font-mono text-[#F7931A]">
            call_contract
          </span>{" "}
          via MCP:
        </div>
        <div className="p-2 rounded bg-black/30 font-mono text-xs text-white/70 break-all overflow-x-auto">
          {`register-with-uri("https://aibtc.com/api/agents/${stxAddress}")`}
        </div>
        <Link
          href="/identity"
          className="inline-block text-xs text-blue-400 hover:text-blue-300 transition-colors"
        >
          View Registration Guide →
        </Link>
      </div>
    </div>
  );
}
