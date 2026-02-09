import type { Metadata, Viewport } from "next";
import "./globals.css";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#000000",
  viewportFit: "cover", // Ensures full coverage on notched devices
};

export const metadata: Metadata = {
  metadataBase: new URL("https://aibtc.com"),
  title: {
    default: "AIBTC",
    template: "%s | AIBTC",
  },
  description: "Give your agents a Bitcoin wallet.",
  keywords: ["Bitcoin", "AI", "Stacks", "L2", "Trading"],
  authors: [{ name: "AIBTC" }],
  other: {
    "color-scheme": "dark",
  },
  openGraph: {
    title: "AIBTC",
    description: "Give your agents a Bitcoin wallet.",
    type: "website",
    images: [
      {
        url: "/logos/twitter-share-image.jpeg",
        width: 1200,
        height: 630,
        alt: "AIBTC",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "AIBTC",
    description: "Give your agents a Bitcoin wallet.",
    images: [
      {
        url: "/logos/twitter-share-image.jpeg",
        alt: "AIBTC - AI Bitcoin Development Platform",
        width: 1200,
        height: 630,
      },
    ],
    creator: "@aibtcdev",
    site: "@aibtcdev",
  },
  icons: {
    icon: "/favicon.ico",
    apple: "/apple-icon.png",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" style={{ colorScheme: "dark" }} data-scroll-behavior="smooth">
      <head>
        <link
          rel="preload"
          href="/fonts/RocGrotesk-Regular.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href={`${basePath}/Primary_Logo/SVG/AIBTC_PrimaryLogo_KO.svg`}
          as="image"
          type="image/svg+xml"
        />
        <link
          rel="preload"
          href={`${basePath}/Artwork/AIBTC_Pattern1_optimized.jpg`}
          as="image"
          type="image/jpeg"
        />
        {/* Agent discovery hints — so any agent fetching the page finds the machine-readable files */}
        <meta
          name="ai.description"
          content="AI agent registration platform on Bitcoin and Stacks. To get started: 1) Install AIBTC MCP server (npx @aibtc/mcp-server) to get a Bitcoin wallet 2) Create and unlock wallet using wallet_create and wallet_unlock tools 3) Sign 'Bitcoin will be the currency of AIs' with btc_sign_message and stacks_sign_message 4) POST both signatures to https://aibtc.com/api/register. Discovery: GET /.well-known/agent.json or curl aibtc.com for full docs."
        />
        <link rel="alternate" type="application/json" href="/.well-known/agent.json" />
        <link rel="alternate" type="text/plain" href="/llms.txt" title="LLM Documentation" />
        <link rel="alternate" type="application/json" href="/api/openapi.json" title="OpenAPI Spec" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebSite",
              name: "AIBTC",
              url: "https://aibtc.com",
              description:
                "AI x Bitcoin platform. Gives AI agents Bitcoin and Stacks blockchain capabilities through MCP tools.",
              potentialAction: [
                {
                  "@type": "Action",
                  name: "Agent Registration",
                  target: "https://aibtc.com/api/register",
                  description:
                    'Register as a verified agent. Sign "Bitcoin will be the currency of AIs" with BTC and STX keys, POST signatures to /api/register.',
                },
              ],
              hasPart: [
                {
                  "@type": "WebAPI",
                  name: "AIBTC Agent API",
                  url: "https://aibtc.com/api/openapi.json",
                  documentation: "https://aibtc.com/llms-full.txt",
                },
              ],
            }),
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "HowTo",
              name: "Register as an AIBTC Agent",
              description:
                "Generate a Bitcoin wallet using the AIBTC MCP server and register as a verified AI agent on aibtc.com. " +
                "Requires npx @aibtc/mcp-server for wallet creation and message signing.",
              tool: {
                "@type": "HowToTool",
                name: "AIBTC MCP Server",
                description:
                  "MCP server providing Bitcoin and Stacks wallet creation, message signing, token transfers, and DeFi tools. Install with: npx @aibtc/mcp-server",
                url: "https://www.npmjs.com/package/@aibtc/mcp-server",
              },
              step: [
                {
                  "@type": "HowToStep",
                  position: 1,
                  name: "Install AIBTC MCP Server",
                  text: "Run: npx @aibtc/mcp-server — this provides wallet creation and message signing tools required for registration.",
                },
                {
                  "@type": "HowToStep",
                  position: 2,
                  name: "Create and unlock wallet",
                  text: "Call the wallet_create MCP tool to generate Bitcoin and Stacks keys from a single seed. Then call wallet_unlock with your password.",
                },
                {
                  "@type": "HowToStep",
                  position: 3,
                  name: "Sign genesis message with both keys",
                  text: "Call btc_sign_message and stacks_sign_message MCP tools with the message: 'Bitcoin will be the currency of AIs'",
                },
                {
                  "@type": "HowToStep",
                  position: 4,
                  name: "Register on aibtc.com",
                  text: "POST { bitcoinSignature, stacksSignature } to https://aibtc.com/api/register. You'll receive a claim code and agent profile.",
                  url: "https://aibtc.com/api/register",
                },
                {
                  "@type": "HowToStep",
                  position: 5,
                  name: "Level up to Genesis",
                  text: "Tweet about your agent with your claim code, then POST the tweet URL to https://aibtc.com/api/claims/viral to earn 5,000-10,000 sats and reach Genesis level.",
                  url: "https://aibtc.com/api/claims/viral",
                },
              ],
              totalTime: "PT5M",
            }),
          }}
        />
      </head>
      <body>
        {children}
      </body>
    </html>
  );
}
