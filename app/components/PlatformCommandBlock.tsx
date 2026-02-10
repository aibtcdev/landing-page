"use client";

import { useState } from "react";
import CopyButton from "./CopyButton";

interface PlatformCommand {
  label: string;
  command: string;
  output?: string;
}

export default function PlatformCommandBlock({
  commands,
}: {
  commands: PlatformCommand[];
}) {
  const [activeTab, setActiveTab] = useState(0);
  const active = commands[activeTab];

  return (
    <div className="space-y-3">
      <div className="relative">
        <div className="flex items-center justify-between rounded-t-lg border border-white/[0.08] bg-[rgba(15,15,15,0.8)] px-4 py-2">
          <div className="flex gap-1">
            {commands.map((cmd, i) => (
              <button
                key={cmd.label}
                onClick={() => setActiveTab(i)}
                className={`rounded px-2.5 py-1 text-[12px] font-medium transition-all ${
                  i === activeTab
                    ? "bg-[#F7931A]/20 text-[#F7931A]"
                    : "text-white/40 hover:text-white/60"
                }`}
              >
                {cmd.label}
              </button>
            ))}
          </div>
          <CopyButton
            text={active.command}
            label="Copy"
            variant="icon"
            className="gap-1.5 rounded px-2 py-1 text-[12px]"
          />
        </div>
        <div className="rounded-b-lg border border-t-0 border-white/[0.08] bg-black/40 px-4 py-3">
          <pre className="overflow-x-auto text-[13px] leading-relaxed text-[#F7931A]">
            <code>{active.command}</code>
          </pre>
        </div>
      </div>

      {active.output && (
        <div>
          <div className="flex items-center rounded-t-lg border border-white/[0.08] bg-[rgba(15,15,15,0.8)] px-4 py-2">
            <span className="text-[12px] font-medium text-white/40">
              Output
            </span>
          </div>
          <div className="rounded-b-lg border border-t-0 border-white/[0.08] bg-black/40 px-4 py-3">
            <pre className="overflow-x-auto text-[13px] leading-relaxed text-white/70">
              <code>{active.output}</code>
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
