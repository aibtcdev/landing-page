import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Guide: Vibe Coding with Bitcoin Agents | AIBTC",
  description: "A plain-language guide for non-technical builders who want to create AI agents with Bitcoin wallets and payment-gated APIs on Stacks.",
  openGraph: {
    title: "Guide: Vibe Coding with Bitcoin Agents",
    description: "Build AI agents with their own Bitcoin wallets and payment-gated APIs. No coding experience required.",
    url: "https://aibtc.com/guide",
    images: ["/guide/og-image.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Guide: Vibe Coding with Bitcoin Agents",
    description: "Build AI agents with their own Bitcoin wallets and payment-gated APIs. No coding experience required.",
    site: "@aibtcdev",
    images: ["/guide/og-image.png"],
  },
};

export default function GuideLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
