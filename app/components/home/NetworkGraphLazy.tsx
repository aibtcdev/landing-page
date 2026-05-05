"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type NetworkGraph from "./NetworkGraph";

/**
 * Lazy wrapper around the homepage NetworkGraph.
 *
 * NetworkGraph is a ~300-line SVG component with setInterval-driven
 * edge/packet animations. It isn't required for first paint of the
 * hero copy above it, so we defer it via next/dynamic with
 * `ssr: false`. The page is still server-rendered; only this client
 * subtree streams in after hydration, freeing the initial bundle for
 * above-the-fold content.
 */
const NetworkGraphInner = dynamic(() => import("./NetworkGraph"), {
  ssr: false,
  // Reserve roughly the canvas height while the chunk loads so the
  // section doesn't pop / shift content below it.
  loading: () => (
    <div
      className="mx-auto max-w-[1240px] rounded-[20px] border"
      style={{
        borderColor: "var(--line)",
        background:
          "radial-gradient(ellipse at center, rgba(247,147,26,0.06) 0%, transparent 60%), rgba(10,10,10,0.6)",
        aspectRatio: "1240 / 600",
      }}
      aria-hidden
    />
  ),
});

type Props = ComponentProps<typeof NetworkGraph>;

export default function NetworkGraphLazy(props: Props) {
  return <NetworkGraphInner {...props} />;
}
