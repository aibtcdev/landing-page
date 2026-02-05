import { fetchGitHubScript } from "@/lib/github-proxy";

export async function GET() {
  return fetchGitHubScript("/update-skill.sh");
}
