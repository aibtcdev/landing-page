import type { Metadata } from "next";
import Navbar from "../../components/Navbar";
import Footer from "../../components/Footer";
import AnimatedBackground from "../../components/AnimatedBackground";
import OwnerActions from "./OwnerActions";

// Stacks contract id: <c32-address>.<contract-name>
const CONTRACT_RE = /^S[PMNT][0-9A-Z]{38,40}\.[a-zA-Z][a-zA-Z0-9_-]{0,127}$/;

function parseContract(
  raw: string
): { contract: string; network: "mainnet" | "testnet" } | null {
  const contract = decodeURIComponent(raw);
  if (!CONTRACT_RE.test(contract)) return null;
  const network =
    contract.startsWith("ST") || contract.startsWith("SN")
      ? "testnet"
      : "mainnet";
  return { contract, network };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ contract: string }>;
}): Promise<Metadata> {
  const { contract } = await params;
  return {
    title: "Agent Account — Owner Actions",
    description: `Connect your wallet and set agent permissions for ${decodeURIComponent(contract)}.`,
    // Per-account action pages are reached via a handoff link, not search.
    robots: { index: false, follow: false },
  };
}

export default async function AccountOwnerPage({
  params,
}: {
  params: Promise<{ contract: string }>;
}) {
  const { contract: raw } = await params;
  const parsed = parseContract(raw);

  return (
    <div className="relative min-h-screen">
      <AnimatedBackground />
      <Navbar />

      <div className="relative mx-auto max-w-3xl px-4 pb-20 pt-24">
        <h1 className="mb-3 text-4xl font-bold text-white md:text-5xl">
          Agent Account — Owner Actions
        </h1>

        {parsed ? (
          <>
            <p className="mb-2 text-lg text-white/60">
              You are the owner of this agent account. Connect your wallet and
              grant or revoke what the agent is allowed to do. Only the owner
              can change these.
            </p>
            <p className="mb-10 font-mono text-xs break-all text-white/40">
              {parsed.contract}
            </p>
            <OwnerActions contract={parsed.contract} network={parsed.network} />
          </>
        ) : (
          <p className="mt-6 rounded-lg border border-white/10 bg-white/5 p-6 text-white/70">
            <span className="text-red-400">Invalid contract id.</span> Expected
            a Stacks agent-account contract like{" "}
            <span className="font-mono text-white/80">
              SP….aibtc-acct-…
            </span>
            . Open this page from the link your agent (MCP) provided.
          </p>
        )}
      </div>

      <Footer />
    </div>
  );
}
