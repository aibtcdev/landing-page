import AnimatedBackground from "../components/AnimatedBackground";
import Navbar from "../components/Navbar";
import ActivityContent from "./ActivityContent";

/**
 * /activity — Network Activity page.
 *
 * Server Component shell: renders static chrome (background, navbar) on the
 * server, then hands off to the ActivityContent client component for live
 * data fetching and the animated feed.
 */
export default function ActivityPage() {
  return (
    <>
      <AnimatedBackground />
      <Navbar />
      <main className="relative min-h-screen">
        <ActivityContent />
      </main>
    </>
  );
}
