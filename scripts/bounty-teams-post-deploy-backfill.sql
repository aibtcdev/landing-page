-- Post-deploy backfill for migration 032 (bounty team submissions).
--
-- Run ONCE right after the code from the team-submissions PR is deployed:
--   npm run wrangler -- d1 execute landing-page --remote --env production \
--     --file scripts/bounty-teams-post-deploy-backfill.sql
--
-- Why: 032 runs before the deploy. In the minutes between the two, the old
-- code is still live and writes only the old columns: a submission without a
-- member row, or a payout only on bounties.paid_txid. This repeats 032's
-- backfill for exactly those rows. Idempotent: safe to run more than once,
-- and it never touches a row the new code wrote.

-- Submissions with no member row become a confirmed team of one.
INSERT OR IGNORE INTO bounty_submission_members
  (submission_id, bounty_id, member_btc_address, member_stx_address, role,
   share_sats, confirmed_at, legacy)
SELECT s.id, s.bounty_id, s.submitter_btc_address, s.submitter_stx_address, 'lead',
       b.reward_sats, s.created_at, 1
FROM bounty_submissions s
JOIN bounties b ON b.id = s.bounty_id
WHERE NOT EXISTS (SELECT 1 FROM bounty_submission_members m WHERE m.submission_id = s.id);

-- Payouts the old code recorded on the bounty row only: copy them onto the
-- winner's row. Only solo winners (the old code had no teams) whose row has
-- no payment yet, so team payouts recorded by the new code are never touched.
UPDATE bounty_submission_members
SET paid_txid = (SELECT b.paid_txid FROM bounties b WHERE b.accepted_submission_id = bounty_submission_members.submission_id),
    paid_at   = (SELECT b.paid_at   FROM bounties b WHERE b.accepted_submission_id = bounty_submission_members.submission_id)
WHERE paid_txid IS NULL
  AND role = 'lead'
  AND submission_id IN (
    SELECT accepted_submission_id FROM bounties
    WHERE accepted_submission_id IS NOT NULL AND paid_txid IS NOT NULL
  )
  AND (SELECT COUNT(*) FROM bounty_submission_members t
       WHERE t.submission_id = bounty_submission_members.submission_id) = 1;
