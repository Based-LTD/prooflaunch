-- Proof Launch Database Schema
-- Run this in your Supabase SQL editor

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Meme status enum
create type meme_status as enum ('pending', 'backing', 'funded', 'launching', 'live', 'failed');

-- Backing status enum
create type backing_status as enum ('pending', 'confirmed', 'refunded', 'distributed');

-- Users table
create table users (
  wallet_address text primary key,
  created_at timestamp with time zone default now(),

  -- Stats
  memes_created integer default 0,
  memes_backed integer default 0,
  total_backed_sol numeric(20, 9) default 0,

  -- Reputation
  successful_launches integer default 0,
  reputation_score integer default 0
);

-- Memes table
create table memes (
  id uuid primary key default uuid_generate_v4(),
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),

  -- Creator
  creator_wallet text references users(wallet_address),

  -- Token metadata
  name text not null,
  symbol text not null,
  description text not null,
  image_url text not null,

  -- Social links
  twitter text,
  telegram text,
  discord text,
  website text,

  -- Backing config
  backing_goal_sol numeric(20, 9) not null,
  current_backing_sol numeric(20, 9) default 0,
  backing_deadline timestamp with time zone not null,

  -- Status
  status meme_status default 'pending',

  -- Launch info
  mint_address text,
  pump_fun_url text,
  launched_at timestamp with time zone,

  -- Fees
  submission_fee_paid boolean default false,
  platform_fee_bps integer default 200  -- 2% default
);

-- Backings table
create table backings (
  id uuid primary key default uuid_generate_v4(),
  created_at timestamp with time zone default now(),

  meme_id uuid references memes(id) on delete cascade,
  backer_wallet text references users(wallet_address),
  amount_sol numeric(20, 9) not null,

  -- Transaction tracking
  deposit_tx text,
  refund_tx text,
  token_distribution_tx text,

  -- Status
  status backing_status default 'pending',

  -- Unique constraint: one backing per user per meme
  unique(meme_id, backer_wallet)
);

-- Indexes for performance
create index idx_memes_status on memes(status);
create index idx_memes_creator on memes(creator_wallet);
create index idx_memes_deadline on memes(backing_deadline);
create index idx_backings_meme on backings(meme_id);
create index idx_backings_backer on backings(backer_wallet);

-- Function to update meme's current_backing_sol
create or replace function update_meme_backing()
returns trigger as $$
begin
  update memes
  set current_backing_sol = (
    select coalesce(sum(amount_sol), 0)
    from backings
    where meme_id = new.meme_id
    and status = 'confirmed'
  ),
  updated_at = now()
  where id = new.meme_id;

  -- Check if goal reached
  update memes
  set status = 'funded'
  where id = new.meme_id
  and current_backing_sol >= backing_goal_sol
  and status = 'backing';

  return new;
end;
$$ language plpgsql;

-- Trigger to auto-update backing totals
create trigger trigger_update_meme_backing
after insert or update on backings
for each row execute function update_meme_backing();

-- Function to update user stats
create or replace function update_user_stats()
returns trigger as $$
begin
  -- Update backer stats
  update users
  set
    memes_backed = (select count(distinct meme_id) from backings where backer_wallet = new.backer_wallet and status = 'confirmed'),
    total_backed_sol = (select coalesce(sum(amount_sol), 0) from backings where backer_wallet = new.backer_wallet and status = 'confirmed')
  where wallet_address = new.backer_wallet;

  return new;
end;
$$ language plpgsql;

create trigger trigger_update_user_stats
after insert or update on backings
for each row execute function update_user_stats();

-- Row Level Security (RLS)
alter table users enable row level security;
alter table memes enable row level security;
alter table backings enable row level security;

-- Policies: Anyone can read
create policy "Anyone can view users" on users for select using (true);
create policy "Anyone can view memes" on memes for select using (true);
create policy "Anyone can view backings" on backings for select using (true);

-- Policies: Service role can do everything (for API routes)
create policy "Service role full access users" on users for all using (auth.role() = 'service_role');
create policy "Service role full access memes" on memes for all using (auth.role() = 'service_role');
create policy "Service role full access backings" on backings for all using (auth.role() = 'service_role');

-- View for memes with backer count
create or replace view memes_with_stats as
select
  m.*,
  (select count(*) from backings b where b.meme_id = m.id and b.status = 'confirmed') as backer_count,
  (m.backing_goal_sol - m.current_backing_sol) as remaining_sol,
  (m.current_backing_sol / m.backing_goal_sol * 100) as progress_percent
from memes m;

-- RPC functions for updating user stats
create or replace function increment_memes_created(wallet text)
returns void as $$
begin
  update users
  set memes_created = memes_created + 1
  where wallet_address = wallet;
end;
$$ language plpgsql security definer;

create or replace function increment_successful_launches(wallet text)
returns void as $$
begin
  update users
  set successful_launches = successful_launches + 1,
      reputation_score = reputation_score + 10
  where wallet_address = wallet;
end;
$$ language plpgsql security definer;
