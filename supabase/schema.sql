-- ─────────────────────────────────────────────────────────────────────────────
-- KeyLink Database Schema
-- Run this in: Supabase Dashboard → SQL Editor → New Query → Run
-- ─────────────────────────────────────────────────────────────────────────────

-- Enable UUID generation
create extension if not exists "pgcrypto";

-- ── USERS ─────────────────────────────────────────────────────────────────────
create table if not exists users (
  id           uuid primary key default gen_random_uuid(),
  phone        text not null unique,
  name         text,
  role         text check (role in ('tenant', 'landlord')),
  avatar       text,
  verified     boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index on users (phone);

-- ── LISTINGS ──────────────────────────────────────────────────────────────────
create table if not exists listings (
  id              uuid primary key default gen_random_uuid(),
  landlord_id     uuid not null references users(id) on delete cascade,
  title           text not null,
  description     text,
  address         text not null,
  city            text not null,
  state           text,
  zip             text,
  lat             double precision,
  lng             double precision,
  price           integer not null,                -- monthly rent in USD cents (store as dollars)
  bedrooms        integer not null default 1,
  bathrooms       numeric(3,1) not null default 1,
  sqft            integer not null default 0,
  property_type   text not null default 'apartment'
                    check (property_type in ('apartment','house','condo','studio','townhouse','commercial')),
  amenities       text[] not null default '{}',
  photos          text[] not null default '{}',
  status          text not null default 'active'
                    check (status in ('active','rented','paused','draft')),
  available_from  date,
  view_count      integer not null default 0,
  applicant_count integer not null default 0,
  refreshed_at    timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index on listings (status, refreshed_at desc);
create index on listings (landlord_id);
create index on listings (city);

-- Increment applicant count safely
create or replace function increment_applicant_count(listing_id uuid)
returns void language sql as $$
  update listings set applicant_count = applicant_count + 1 where id = listing_id;
$$;

-- ── APPLICATIONS ──────────────────────────────────────────────────────────────
create table if not exists applications (
  id              uuid primary key default gen_random_uuid(),
  listing_id      uuid not null references listings(id) on delete cascade,
  tenant_id       uuid not null references users(id) on delete cascade,
  tenant_name     text,
  tenant_phone    text,
  message         text not null,
  income          integer not null,               -- monthly income in USD
  ai_match_score  integer,                        -- 0-100
  ai_summary      text,
  status          text not null default 'pending'
                    check (status in ('pending','approved','rejected','withdrawn')),
  created_at      timestamptz not null default now(),
  unique (listing_id, tenant_id)                  -- one application per listing per tenant
);

create index on applications (listing_id);
create index on applications (tenant_id);

-- ── CONVERSATIONS ─────────────────────────────────────────────────────────────
create table if not exists conversations (
  id               uuid primary key default gen_random_uuid(),
  listing_id       uuid not null references listings(id) on delete cascade,
  tenant_id        uuid not null references users(id) on delete cascade,
  landlord_id      uuid not null references users(id) on delete cascade,
  last_message     text,
  last_message_at  timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  unique (listing_id, tenant_id)                   -- one conversation per listing per tenant
);

create index on conversations (tenant_id, last_message_at desc);
create index on conversations (landlord_id, last_message_at desc);

-- ── MESSAGES ──────────────────────────────────────────────────────────────────
create table if not exists messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references conversations(id) on delete cascade,
  sender_id        uuid not null references users(id) on delete cascade,
  text             text not null,
  delivered_at     timestamptz,
  read_at          timestamptz,
  created_at       timestamptz not null default now()
);

create index on messages (conversation_id, created_at desc);

-- ── SAVED LISTINGS ────────────────────────────────────────────────────────────
create table if not exists saved_listings (
  user_id     uuid not null references users(id) on delete cascade,
  listing_id  uuid not null references listings(id) on delete cascade,
  saved_at    timestamptz not null default now(),
  primary key (user_id, listing_id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Row Level Security (RLS)
-- All reads/writes go through service-role key on the backend,
-- so RLS is a safety net in case of direct DB access.
-- ─────────────────────────────────────────────────────────────────────────────

alter table users           enable row level security;
alter table listings        enable row level security;
alter table applications    enable row level security;
alter table conversations   enable row level security;
alter table messages        enable row level security;
alter table saved_listings  enable row level security;

-- Service role bypasses RLS automatically — no policies needed for backend.
-- Add policies here if you ever expose anon/authenticated Supabase keys to clients.
