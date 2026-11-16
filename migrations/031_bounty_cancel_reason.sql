-- Migration 031: optional cancel_reason and ruling_url on bounties (#1129)
--
-- Allows a poster to attach an explanation and ruling URL when cancelling a bounty.

ALTER TABLE bounties ADD COLUMN cancel_reason TEXT;
ALTER TABLE bounties ADD COLUMN ruling_url TEXT;
