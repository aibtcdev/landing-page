"use client";

import { useEffect, useState } from "react";
import { Cl } from "@stacks/transactions";

type Network = "mainnet" | "testnet";

interface Permission {
  fn: string;
  label: string;
  desc: string;
}

// The four owner-only setters on aibtc-acct. Each takes a single bool and is
// gated by `(asserts! (is-owner) ...)` on-chain — the agent (MCP) wallet
// cannot sign these, only the account owner can.
const PERMISSIONS: Permission[] = [
  {
    fn: "set-agent-can-manage-assets",
    label: "Manage assets",
    desc: "Deposit and withdraw STX and tokens. Withdrawals always route back to you, the owner.",
  },
  {
    fn: "set-agent-can-use-proposals",
    label: "Use proposals",
    desc: "Create, vote on, conclude, and veto DAO action proposals.",
  },
  {
    fn: "set-agent-can-approve-revoke-contracts",
    label: "Approve / revoke contracts",
    desc: "Add or remove contracts from the account's allowlist (voting, swap, token).",
  },
  {
    fn: "set-agent-can-buy-sell-assets",
    label: "Buy / sell assets",
    desc: "Trade DAO tokens through approved swap adapters.",
  },
];

type Result =
  | { fn: string; enabled: boolean; txid: string }
  | { fn: string; enabled: boolean; error: string };

function shortAddr(addr: string): string {
  return `${addr.slice(0, 5)}…${addr.slice(-4)}`;
}

export default function OwnerActions({
  contract,
  network,
}: {
  contract: string;
  network: Network;
}) {
  const [connected, setConnected] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // `${fn}:${enabled}`
  const [result, setResult] = useState<Result | null>(null);

  // @stacks/connect touches localStorage, so it is imported lazily (browser
  // only) — never during server render.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { isConnected, getLocalStorage } = await import("@stacks/connect");
      if (!cancelled && isConnected()) {
        setConnected(getLocalStorage()?.addresses?.stx?.[0]?.address ?? null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function ensureConnected(): Promise<void> {
    const { isConnected, connect, getLocalStorage } = await import("@stacks/connect");
    if (!isConnected()) {
      await connect();
    }
    setConnected(getLocalStorage()?.addresses?.stx?.[0]?.address ?? null);
  }

  async function handleConnect() {
    try {
      await ensureConnected();
    } catch {
      /* user dismissed the wallet picker */
    }
  }

  async function handleDisconnect() {
    const { disconnect } = await import("@stacks/connect");
    disconnect();
    setConnected(null);
  }

  async function handleToggle(fn: string, enabled: boolean) {
    const key = `${fn}:${enabled}`;
    setResult(null);
    setBusy(key);
    try {
      await ensureConnected();
      const { request } = await import("@stacks/connect");
      const res = await request("stx_callContract", {
        contract: contract as `${string}.${string}`,
        functionName: fn,
        functionArgs: [Cl.bool(enabled)],
        network,
        postConditionMode: "deny",
        postConditions: [],
      });
      if (!res.txid) throw new Error("Wallet did not return a transaction id.");
      setResult({ fn, enabled, txid: res.txid });
    } catch (e) {
      setResult({
        fn,
        enabled,
        error: e instanceof Error ? e.message : "Signing was cancelled or failed.",
      });
    } finally {
      setBusy(null);
    }
  }

  const explorerTx = (txid: string) =>
    `https://explorer.hiro.so/txid/${txid}?chain=${network}`;

  return (
    <>
      {/* Connect bar */}
      <div className="mb-8 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/5 p-4">
        {connected ? (
          <>
            <span className="text-sm text-white/70">
              Connected as{" "}
              <span className="font-mono text-white" title={connected}>
                {shortAddr(connected)}
              </span>
            </span>
            <button
              type="button"
              onClick={handleDisconnect}
              className="rounded-md border border-white/15 px-3 py-1.5 text-sm text-white/70 transition-colors hover:text-white"
            >
              Disconnect
            </button>
          </>
        ) : (
          <>
            <span className="text-sm text-white/60">
              Connect the owner wallet to sign.
            </span>
            <button
              type="button"
              onClick={handleConnect}
              className="rounded-md bg-[#F7931A] px-4 py-1.5 text-sm font-semibold text-black transition-opacity hover:opacity-90"
            >
              Connect wallet
            </button>
          </>
        )}
      </div>

      {/* Permission cards */}
      <div className="space-y-4">
        {PERMISSIONS.map((p) => {
          const grantBusy = busy === `${p.fn}:true`;
          const revokeBusy = busy === `${p.fn}:false`;
          const rowResult = result?.fn === p.fn ? result : null;
          return (
            <section
              key={p.fn}
              className="rounded-lg border border-white/10 bg-white/5 p-6"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-white">{p.label}</h2>
                  <p className="mt-1 text-sm text-white/60">{p.desc}</p>
                  <p className="mt-2 font-mono text-xs text-white/35">{p.fn}</p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => handleToggle(p.fn, true)}
                    className="rounded-md bg-[#F7931A] px-4 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {grantBusy ? "Signing…" : "Grant"}
                  </button>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => handleToggle(p.fn, false)}
                    className="rounded-md border border-white/20 px-4 py-2 text-sm font-semibold text-white/80 transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {revokeBusy ? "Signing…" : "Revoke"}
                  </button>
                </div>
              </div>

              {rowResult && (
                <div className="mt-4 border-t border-white/10 pt-4 text-sm">
                  {"txid" in rowResult ? (
                    <p className="text-white/70">
                      {rowResult.enabled ? "Granting" : "Revoking"} submitted —{" "}
                      <a
                        href={explorerTx(rowResult.txid)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#7DA2FF] underline underline-offset-2 hover:text-white"
                      >
                        view transaction
                      </a>
                      . It takes effect once confirmed on-chain.
                    </p>
                  ) : (
                    <p className="text-red-400">{rowResult.error}</p>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}
