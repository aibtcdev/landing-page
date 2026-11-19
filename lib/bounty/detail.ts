/**
 * The team-aware pieces of a bounty detail view, shared by the detail API
 * route and the /bounties/[id] page so the two never disagree.
 */

import { DETAIL_SUBMISSIONS_PAGE, SBTC_CONTRACT_MAINNET } from "./constants";
import { buildPayout, getSubmission, listSubmissionsForBounty, withTeams } from "./d1-helpers";
import { buildExpectedMemo } from "./txid-verify";
import {
  bountyStatus,
  type BountyPaymentHint,
  type BountyPayout,
  type BountyRecord,
  type BountyStatus,
  type BountySubmission,
  type BountyTeamMember,
  type BountyWinner,
} from "./types";

export interface BountyDetailParts {
  status: BountyStatus;
  /** First page of submissions (oldest first), each with its team. */
  submissions: BountySubmission[];
  submissionCount: number;
  submissionsNextOffset: number | null;
  winner?: BountyWinner;
  /** Payout progress of the winning submission, once one is accepted. */
  payout?: BountyPayout;
  /** One transfer per unpaid member while status is winner-announced. */
  payments?: BountyPaymentHint[];
  /** Solo winner only: the single transfer, kept for older clients. */
  payment?: BountyPaymentHint;
}

export async function loadBountyDetail(
  db: D1Database,
  bounty: BountyRecord,
  now: Date = new Date()
): Promise<BountyDetailParts> {
  const status = bountyStatus(bounty, now);

  // The inline page is the OLDEST submissions (created_at ASC), so once a
  // bounty passes the page size the newest entries are not in this response.
  // `submissionsNextOffset` tells a poster to page through
  // /api/bounties/{id}/submissions instead of judging from this page alone.
  const page = await listSubmissionsForBounty(
    db,
    bounty.id,
    DETAIL_SUBMISSIONS_PAGE,
    0,
    bounty.submissionCount
  );
  const submissionCount = page.total;
  // A full page with more counted behind it means there is a next page. A
  // short page is the end even if the stored count says otherwise.
  const submissionsNextOffset =
    page.submissions.length === DETAIL_SUBMISSIONS_PAGE && page.submissions.length < submissionCount
      ? page.submissions.length
      : null;

  // The winning submission may sit past the inline page; load it with its team.
  let winningSub = bounty.acceptedSubmissionId
    ? page.submissions.find((s) => s.id === bounty.acceptedSubmissionId)
    : undefined;
  if (bounty.acceptedSubmissionId && !winningSub) {
    winningSub = (await getSubmission(db, bounty.acceptedSubmissionId)) ?? undefined;
  }
  const withTeam = await withTeams(db, winningSub && !page.submissions.includes(winningSub)
    ? [...page.submissions, winningSub]
    : page.submissions);
  const submissions = withTeam.slice(0, page.submissions.length);
  const winnerSub = bounty.acceptedSubmissionId
    ? withTeam.find((s) => s.id === bounty.acceptedSubmissionId)
    : undefined;

  const parts: BountyDetailParts = { status, submissions, submissionCount, submissionsNextOffset };
  if (!winnerSub || !bounty.acceptedAt) return parts;

  // A winner stored by older code has no member rows: show it as the solo
  // entry it is (whole reward to the lead, paid if the bounty row says so),
  // built in memory so this read path never writes.
  const team: BountyTeamMember[] =
    winnerSub.team && winnerSub.team.length > 0
      ? winnerSub.team
      : [
          {
            btcAddress: winnerSub.submitterBtcAddress,
            stxAddress: winnerSub.submitterStxAddress,
            role: "lead",
            shareSats: bounty.rewardSats,
            confirmed: true,
            ...(bounty.paidTxid && { paidTxid: bounty.paidTxid }),
            ...(bounty.paidAt && { paidAt: bounty.paidAt }),
          },
        ];
  parts.winner = {
    submissionId: winnerSub.id,
    submitterBtcAddress: winnerSub.submitterBtcAddress,
    submitterStxAddress: winnerSub.submitterStxAddress,
    ...(winnerSub.contentUrl && { contentUrl: winnerSub.contentUrl }),
    message: winnerSub.message,
    acceptedAt: bounty.acceptedAt,
    team,
  };
  parts.payout = buildPayout(team);

  if (status === "winner-announced") {
    const memo = buildExpectedMemo(bounty.id);
    parts.payments = parts.payout.unpaid.map((u) => ({
      expectedMemo: memo.ascii,
      expectedMemoHex: memo.hex,
      recipientStxAddress: u.stxAddress,
      recipientBtcAddress: u.btcAddress,
      amountSats: u.amountSats,
      sbtcContract: SBTC_CONTRACT_MAINNET,
    }));
    if (team.length === 1 && parts.payments.length === 1) parts.payment = parts.payments[0];
  }
  return parts;
}
