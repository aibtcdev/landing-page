import type { SponsorStatusResult } from "@/lib/sponsor/types";

export interface MainnetHealth {
  status: string;
  environment: string;
  timestamp: string;
}

export interface TestnetHealth {
  success: boolean;
  status: string;
  network: string;
  version: string;
}

export interface StatusData {
  mainnet: MainnetHealth | null;
  testnet: TestnetHealth | null;
  sponsorStatus: SponsorStatusResult | null;
}
