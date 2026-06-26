-- Sherwin-Williams Live Portal video analytics schema
-- Run this in Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.sw_live_events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  status text not null default 'scheduled',
  ivs_playback_url text,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists public.sw_view_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id text,
  driver_name text,
  device_id text,
  content_type text not null,
  live_event_id uuid,
  archive_video_id uuid,
  started_at timestamptz not null default now(),
  last_heartbeat_at timestamptz not null default now(),
  ended_at timestamptz,
  watch_seconds integer not null default 0,
  user_agent text,
  status text not null default 'active'
);

create table if not exists public.sw_video_comments (
  id uuid primary key default gen_random_uuid(),
  user_id text,
  driver_name text,
  content_type text not null,
  live_event_id uuid,
  archive_video_id uuid,
  body text not null,
  status text not null default 'visible',
  created_at timestamptz default now()
);

create or replace view public.sw_live_event_metrics as
select
  e.id,
  e.title,
  count(s.id) as total_live_views,
  count(distinct coalesce(s.user_id, s.device_id)) as unique_live_viewers,
  count(s.id) filter (where s.status = 'active' and s.last_heartbeat_at > now() - interval '45 seconds') as current_viewers,
  coalesce(sum(s.watch_seconds), 0) as total_watch_seconds
from public.sw_live_events e
left join public.sw_view_sessions s on s.live_event_id = e.id and s.content_type = 'live'
group by e.id, e.title;

create or replace view public.sw_archive_video_metrics as
select
  a.id,
  a.title,
  count(s.id) as total_archive_views,
  count(distinct coalesce(s.user_id, s.device_id)) as unique_archive_viewers,
  coalesce(sum(s.watch_seconds), 0) as total_watch_seconds
from public.sw_video_archives a
left join public.sw_view_sessions s on s.archive_video_id = a.id and s.content_type = 'archive'
group by a.id, a.title;

create index if not exists sw_view_sessions_live_event_idx on public.sw_view_sessions(live_event_id);
create index if not exists sw_view_sessions_archive_video_idx on public.sw_view_sessions(archive_video_id);
create index if not exists sw_view_sessions_heartbeat_idx on public.sw_view_sessions(last_heartbeat_at desc);
