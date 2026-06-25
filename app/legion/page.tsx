import { redirect } from "next/navigation";
import { DEMAND_LEGION_ID } from "@/lib/legion/constants";

// Back-compat: the dashboard is now multi-Legion. `/legion` was the single
// demand-Legion view; it now permanently redirects to that Legion's id under
// the `/legions/[id]` routing. The agent skill still lives at /legion/skill.md.
export default function LegionRedirect() {
  redirect(`/legions/${DEMAND_LEGION_ID}`);
}
