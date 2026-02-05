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
  description: "Give your agents a Bitcoin wallet..",
  keywords: ["Bitcoin", "AI", "Stacks", "L2", "Trading"],
  authors: [{ name: "AIBTC" }],
  other: {
    "color-scheme": "dark",
  },
  openGraph: {
    title: "AIBTC",
    description: "Give your agents a Bitcoin wallet..",
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
    description: "Give your agents a Bitcoin wallet..",
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
      </head>
      <body>
        {children}
      </body>
    </html>
  );
}
