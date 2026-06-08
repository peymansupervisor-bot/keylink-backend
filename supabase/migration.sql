-- ─────────────────────────────────────────────────────────────────────────────
-- KeyLink Migration — adapts existing Bakersfield Rental Homes schema
-- Run once in: Supabase Dashboard → SQL Editor → New Query → Run
-- Safe to re-run (uses IF NOT EXISTS / IF NOT EXISTS column checks)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Extend profiles ────────────────────────────────────────────────────────
-- Add phone (for app-only login), role, updated_at to existing profiles table

alter table profiles
  add column if not exists phone       text unique,
  add column if not exists role        text check (role in ('tenant', 'landlord')),
  add column if not exists updated_at  timestamptz not null default now();

create index if not exists profiles_phone_idx on profiles (phone);

-- ── 2. Extend listings ───────────────────────────────────────────────────────
-- Add app-specific columns without touching existing website columns

alter table listings
  add column if not exists landlord_id     uuid references profiles(id) on delete set null,
  add column if not exists property_type  text default 'house',
  add column if not exists view_count     integer not null default 0,
  add column if not exists applicant_count integer not null default 0,
  add column if not exists refreshed_at   timestamptz not null default now(),
  add column if not exists rental_status  text default 'active'
    check (rental_status in ('active', 'rented', 'paused', 'draft'));

-- If rental_status column already existed without constraint, this is safe via add column if not exists
create index if not exists listings_landlord_idx on listings (landlord_id);
create index if not exists listings_rental_status_idx on listings (rental_status, refreshed_at desc);

-- Safely increment applicant count
create or replace function increment_applicant_count(listing_id uuid)
returns void language sql as $$
  update listings set applicant_count = applicant_count + 1 where id = listing_id;
$$;

-- ── 3. Applications ──────────────────────────────────────────────────────────
create table if not exists applications (
  id              uuid primary key default gen_random_uuid(),
  listing_id      uuid not null references listings(id) on delete cascade,
  tenant_id       uuid not null references profiles(id) on delete cascade,
  tenant_name     text,
  tenant_phone    text,
  message         text not null,
  income          integer not null,
  ai_match_score  integer,
  ai_summary      text,
  status          text not null default 'pending'
                    check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  created_at      timestamptz not null default now(),
  unique (listing_id, tenant_id)
);

create index if not exists applications_listing_idx on applications (listing_id);
create index if not exists applications_tenant_idx  on applications (tenant_id);

-- ── 4. Conversations ─────────────────────────────────────────────────────────
create table if not exists conversations (
  id               uuid primary key default gen_random_uuid(),
  listing_id       uuid not null references listings(id) on delete cascade,
  tenant_id        uuid not null references profiles(id) on delete cascade,
  landlord_id      uuid not null references profiles(id) on delete cascade,
  last_message     text,
  last_message_at  timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  unique (listing_id, tenant_id)
);

create index if not exists conversations_tenant_idx   on conversations (tenant_id, last_message_at desc);
create index if not exists conversations_landlord_idx on conversations (landlord_id, last_message_at desc);

-- ── 5. App Messages (separate from existing direct_messages) ─────────────────
create table if not exists app_messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references conversations(id) on delete cascade,
  sender_id        uuid not null references profiles(id) on delete cascade,
  body             text not null,
  delivered_at     timestamptz,
  read_at          timestamptz,
  created_at       timestamptz not null default now()
);

create index if not exists app_messages_conv_idx on app_messages (conversation_id, created_at desc);

-- ── 6. Saved Listings ─────────────────────────────────────────────────────────
create table if not exists saved_listings (
  user_id     uuid not null references profiles(id) on delete cascade,
  listing_id  uuid not null references listings(id) on delete cascade,
  saved_at    timestamptz not null default now(),
  primary key (user_id, listing_id)
);

-- ── 7. RLS ───────────────────────────────────────────────────────────────────
-- Backend uses service-role key (bypasses RLS). Enable RLS as safety net.

alter table applications    enable row level security;
alter table conversations   enable row level security;
alter table app_messages    enable row level security;
alter table saved_listings  enable row level security;
