-- 062 — Robinhood Chain campaign chat
--
-- The SOL chat (chat_messages) is keyed to a memes.id uuid, so RHC
-- campaigns — which live on-chain, not in this database — need their own
-- table keyed by the campaign contract address. Same access model as
-- chat_messages after 045: RLS on, NO public policies; every read and
-- write goes through /api/rhc/chat with the service role, which verifies
-- an EIP-191 wallet signature before inserting.
create table if not exists rhc_chat_messages (
  id uuid primary key default gen_random_uuid(),
  campaign text not null,          -- campaign contract address, lowercase 0x…
  wallet text not null,            -- EVM address, lowercase 0x…
  message text not null check (char_length(message) between 1 and 500),
  created_at timestamptz not null default now()
);

create index if not exists rhc_chat_messages_campaign_created_idx
  on rhc_chat_messages (campaign, created_at);

alter table rhc_chat_messages enable row level security;
