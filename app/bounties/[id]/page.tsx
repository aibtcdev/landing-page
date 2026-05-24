import { permanentRedirect } from "next/navigation";

type BountiesAliasDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function BountiesAliasDetailPage({ params }: BountiesAliasDetailPageProps) {
  const { id } = await params;
  permanentRedirect(`/bounty/${id}`);
}
