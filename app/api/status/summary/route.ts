import { NextResponse } from "next/server";
import { STATUS_REVALIDATE_SECONDS } from "@/app/status/constants";
import { getStatusData } from "@/app/status/data";

export async function GET() {
  const data = await getStatusData();

  return NextResponse.json(data, {
    headers: {
      "Cache-Control": `public, s-maxage=${STATUS_REVALIDATE_SECONDS}, stale-while-revalidate=${STATUS_REVALIDATE_SECONDS}`,
    },
  });
}
