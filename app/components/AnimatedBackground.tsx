const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

export default function AnimatedBackground() {
  return (
    <div
      className="fixed inset-0 -z-10 overflow-hidden bg-gradient-to-br from-black via-[#0a0a0a] to-[#050208]"
      aria-hidden="true"
    >
      {/* Background Pattern */}
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat opacity-[0.12] saturate-[1.3]"
        style={{ backgroundImage: `url('${basePath}/Artwork/AIBTC_Pattern1_optimized.jpg')` }}
      />

      {/* Orbs - more visible */}
      <div className="absolute -right-[100px] -top-[150px] h-[600px] w-[600px] rounded-full bg-[radial-gradient(circle,rgba(247,147,26,0.5)_0%,rgba(247,147,26,0.2)_40%,transparent_70%)] opacity-80 blur-[80px] animate-float1" />
      <div className="absolute -bottom-[150px] -left-[100px] h-[500px] w-[500px] rounded-full bg-[radial-gradient(circle,rgba(125,162,255,0.45)_0%,rgba(125,162,255,0.15)_40%,transparent_70%)] opacity-70 blur-[80px] animate-float2" />
      <div className="absolute bottom-[20%] -right-[100px] h-[400px] w-[400px] rounded-full bg-[radial-gradient(circle,rgba(125,162,255,0.3)_0%,rgba(125,162,255,0.1)_40%,transparent_70%)] opacity-50 blur-[80px] max-md:hidden animate-float1-reverse" />

      {/* Vignette */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(0,0,0,0.6)_0%,rgba(0,0,0,0.3)_40%,transparent_70%)]" />
    </div>
  );
}
