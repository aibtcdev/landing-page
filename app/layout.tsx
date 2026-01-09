import type { Metadata, Viewport } from "next";
import "./globals.css";

export const viewport: Viewport = {
  themeColor: "#000000",
};

export const metadata: Metadata = {
  title: "AIBTC - Building the Agent Economy on Bitcoin",
  description: "AIBTC is a public working group building the agent economy on Bitcoin.",
  openGraph: {
    title: "AIBTC - Building the Agent Economy on Bitcoin",
    description: "We're building the agent economy on Bitcoin. Join the AIBTC public working group and start contributing.",
    type: "website",
    url: "https://aibtc.com",
    images: [
      {
        url: "https://aibtc.com/logos/aibtcdev-logo-opengraph.png",
        width: 1200,
        height: 630,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    site: "@aibtcdev",
    title: "AIBTC - Building the Agent Economy on Bitcoin",
    description: "We're building the agent economy on Bitcoin. Join the AIBTC public working group and start contributing.",
    images: ["https://aibtc.dev/logos/aibtcdev-logo-opengraph.png"],
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
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body>
        {children}
      </body>
    </html>
  );
}
