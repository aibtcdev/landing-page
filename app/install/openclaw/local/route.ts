import { fetchGitHubScript } from "@/lib/github-proxy";

export async function GET() {
  return fetchGitHubScript("/local-setup.sh");
}
