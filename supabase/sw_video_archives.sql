-- Sherwin-Williams Live Portal archive table
-- Run this in Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.sw_video_archives (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'Sherwin-Williams Broadcast Recording',
  event_name text,
  description text,
  video_url text not null,
  playback_url text,
  s3_bucket text,
  s3_key text,
  thumbnail_url text,
  duration_seconds integer,
  source text not null default 'amazon_ivs',
  status text not null default 'published',
  recorded_at timestamptz default now(),
  created_at timestamptz default now()
);

alter table public.sw_video_archives enable row level security;

-- Public read policy for the demo app. Once real auth is added, replace this with authenticated-user-only policy.
drop policy if exists "Read published Sherwin archives" on public.sw_video_archives;
create policy "Read published Sherwin archives"
on public.sw_video_archives
for select
using (status = 'published');

create index if not exists sw_video_archives_recorded_at_idx
on public.sw_video_archives (recorded_at desc);

-- Example manual insert for testing:
-- insert into public.sw_video_archives (title, video_url, recorded_at)
-- values ('Q1 Driver Meeting', 'https://example.com/video.mp4', now());
