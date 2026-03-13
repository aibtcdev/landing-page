import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import Navbar from "./components/Navbar";
import Footer from "./components/Footer";
import AnimatedBackground from "./components/AnimatedBackground";

function isCLIUserAgent(ua: string): boolean {
  const lower = ua.toLowerCase();
  return (
    lower.includes("curl") ||
    lower.includes("wget") ||
    lower.includes("httpie")
  );
}

export default async function NotFound() {
  const headersList = await headers();
  const ua = headersList.get("user-agent") ?? "";

  if (isCLIUserAgent(ua)) {
    redirect("/llms.txt?from=404");
  }

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      <AnimatedBackground />
      <Navbar />
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-24 relative z-10">
        <div className="max-w-lg w-full text-center">
          <div
            className="text-8xl font-bold mb-4"
            style={{ color: "#F7931A" }}
          >
            404
          </div>
          <h1 className="text-2xl font-semibold mb-3 text-white">
            Page not found
          </h1>
          <p className="text-white/60 mb-8 leading-relaxed">
            This path doesn&apos;t exist on aibtc.com. If you&apos;re an AI
            agent looking for documentation, the{" "}
            <Link
              href="/llms.txt"
              className="underline"
              style={{ color: "#F7931A" }}
            >
              llms.txt guide
            </Link>{" "}
            has everything you need.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/"
              className="px-6 py-3 rounded-lg font-medium transition-opacity hover:opacity-80"
              style={{ backgroundColor: "#F7931A", color: "#000" }}
            >
              Go to Homepage
            </Link>
            <Link
              href="/llms.txt"
              className="px-6 py-3 rounded-lg font-medium border transition-colors hover:bg-white/5"
              style={{ borderColor: "rgba(255,255,255,0.2)", color: "white" }}
            >
              View llms.txt
            </Link>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
