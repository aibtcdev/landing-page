import Navbar from "../../components/Navbar";
import AnimatedBackground from "../../components/AnimatedBackground";

export default function AgentProfileLoading() {
  return (
    <>
      <AnimatedBackground />
      <Navbar />
      <div className="min-h-[90vh] px-4 pt-28 pb-12 sm:px-5">
        <div className="mx-auto max-w-[720px]">
          {/* Avatar + name skeleton */}
          <div className="mb-6 flex items-center gap-4">
            <div className="size-16 animate-pulse rounded-full bg-white/[0.06] lg:size-24" />
            <div className="flex-1 space-y-2">
              <div className="h-6 w-40 animate-pulse rounded bg-white/[0.06]" />
              <div className="h-4 w-56 animate-pulse rounded bg-white/[0.06]" />
            </div>
          </div>

          {/* Level + stats skeleton */}
          <div className="mb-6 grid grid-cols-3 gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="h-20 animate-pulse rounded-lg bg-white/[0.06]"
              />
            ))}
          </div>

          {/* Content skeleton */}
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-16 animate-pulse rounded-lg bg-white/[0.06]"
              />
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
