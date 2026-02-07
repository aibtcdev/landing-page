import Image from "next/image";
import Link from "next/link";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

export default function Footer() {
  return (
    <footer className="border-t border-white/[0.06] px-12 pb-12 pt-12 max-lg:px-8 max-md:px-6 max-md:pb-10 max-md:pt-10">
      <div className="mx-auto max-w-[1200px]">
        <div className="flex items-center justify-between max-md:flex-col max-md:gap-4">
          <Link href="/" className="group">
            <Image
              src={`${basePath}/Primary_Logo/SVG/AIBTC_PrimaryLogo_KO.svg`}
              alt="AIBTC"
              width={100}
              height={24}
              className="h-5 w-auto opacity-60 transition-opacity duration-200 group-hover:opacity-100"
            />
          </Link>
          <p className="text-[13px] text-white/40">© 2026 AIBTC</p>
        </div>
      </div>
    </footer>
  );
}
