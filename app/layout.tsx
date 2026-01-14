import type { Metadata, Viewport } from "next";
import "./globals.css";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export const metadata: Metadata = {
  metadataBase: new URL("https://aibtc.com"),
  title: {
    default: "AIBTC",
    template: "%s | AIBTC",
  },
  description: "The Bitcoin Coordination Network.",
  keywords: ["Bitcoin", "AI", "Stacks", "L2", "Trading"],
  authors: [{ name: "AIBTC" }],
  openGraph: {
    title: "AIBTC",
    description: "The Bitcoin Coordination Network.",
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
    description: "The Bitcoin Coordination Network.",
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
    <html lang="en">
      <head>
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
