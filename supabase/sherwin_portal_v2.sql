-- Sherwin-Williams portal schema for the BLB Modules Supabase project.
-- Keep all Sherwin portal data isolated with the sw_ prefix and dedicated sw-media bucket.

create extension if not exists pgcrypto;

create table if not exists public.sw_driver_users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  display_name text not null,
  employee_id text,
  role text not null default 'driver' check (role in ('driver','admin')),
  password_hash text not null,
  password_salt text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_login_at timestamptz
);

create unique index if not exists sw_driver_users_employee_id_uidx
on public.sw_driver_users(employee_id) where employee_id is not null;

create table if not exists public.sw_login_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.sw_driver_users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  user_agent text
);

create index if not exists sw_login_sessions_user_idx on public.sw_login_sessions(user_id);
create index if not exists sw_login_sessions_expires_idx on public.sw_login_sessions(expires_at);

create table if not exists public.sw_live_events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  subtitle text,
  playback_url text not null,
  status text not null default 'offline' check (status in ('scheduled','live','offline','ended')),
  scheduled_at timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  peak_viewers integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sw_live_events_status_idx on public.sw_live_events(status, created_at desc);

create table if not exists public.sw_media_items (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  media_type text not null check (media_type in ('video','audio')),
  storage_bucket text not null default 'sw-media',
  storage_path text not null unique,
  original_name text,
  mime_type text,
  size_bytes bigint,
  duration_seconds integer,
  recorded_at timestamptz not null default now(),
  status text not null default 'published' check (status in ('draft','published','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sw_media_items_status_idx on public.sw_media_items(status, recorded_at desc);

create table if not exists public.sw_video_comments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.sw_driver_users(id) on delete cascade,
  content_type text not null check (content_type in ('live','media')),
  content_id uuid not null,
  body text not null,
  status text not null default 'visible' check (status in ('visible','hidden')),
  created_at timestamptz not null default now()
);

create index if not exists sw_video_comments_content_idx on public.sw_video_comments(content_type, content_id, created_at);

create table if not exists public.sw_view_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.sw_driver_users(id) on delete cascade,
  content_type text not null check (content_type in ('live','media')),
  content_id uuid not null,
  device_id text,
  user_agent text,
  started_at timestamptz not null default now(),
  last_heartbeat_at timestamptz not null default now(),
  ended_at timestamptz,
  watch_seconds integer not null default 0,
  status text not null default 'active' check (status in ('active','ended'))
);

create index if not exists sw_view_sessions_content_idx on public.sw_view_sessions(content_type, content_id, started_at desc);
create index if not exists sw_view_sessions_heartbeat_idx on public.sw_view_sessions(last_heartbeat_at desc);

alter table public.sw_driver_users enable row level security;
alter table public.sw_login_sessions enable row level security;
alter table public.sw_live_events enable row level security;
alter table public.sw_media_items enable row level security;
alter table public.sw_video_comments enable row level security;
alter table public.sw_view_sessions enable row level security;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'sw-media',
  'sw-media',
  false,
  5368709120,
  array['video/mp4','video/webm','video/quicktime','audio/mpeg','audio/mp4','audio/wav','audio/x-wav','audio/aac','audio/ogg']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

insert into public.sw_live_events (title, subtitle, playback_url, status, started_at)
select
  'Sherwin-Williams Driver Live Stream',
  'Quarterly Driver Broadcast',
  'https://0ec79f9267a5.us-east-1.playback.live-video.net/api/video/v1/us-east-1.089601769025.channel.cm8GRMkNVXU8.m3u8',
  'live',
  now()
where not exists (select 1 from public.sw_live_events);