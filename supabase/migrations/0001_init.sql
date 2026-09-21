-- Maison Studio — initial multi-user schema
-- Mirrors the current localStorage data model 1:1 so the web app's existing
-- data shapes migrate cleanly to Supabase. Every table is scoped to the
-- authenticated user via user_id + row level security.
--
-- Run this in the Supabase SQL editor (or `supabase db push`) on a fresh
-- project. Safe to re-run: every statement is guarded with IF NOT EXISTS /
-- OR REPLACE / DROP POLICY IF EXISTS.

-- ============================================================
-- Extensions
-- ============================================================
create extension if not exists "pgcrypto"; -- gen_random_uuid()

-- ============================================================
-- Helper: auto-maintain updated_at on every table that has one
-- ============================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================
-- profiles — one row per Supabase auth user
-- ============================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Auto-create a profile row whenever a new auth user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- content_pillars — content.html "Pillars" list (Beauty, Lifestyle, ...)
-- ============================================================
create table if not exists public.content_pillars (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists content_pillars_user_id_idx on public.content_pillars(user_id);

alter table public.content_pillars enable row level security;
drop policy if exists "content_pillars_owner" on public.content_pillars;
create policy "content_pillars_owner" on public.content_pillars
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================
-- content_items — the Pipeline ("content-desk-items" in localStorage)
-- stage: 0=Ideas 1=Planning 2=Ready to Create 3=Created 4=Editing
--        5=Ready to Post 6=Scheduled 7=Posted
-- ============================================================
create table if not exists public.content_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Untitled',
  platform text not null default 'Other',
  format text not null default '',
  pillar text not null default '',
  thought text not null default '',
  stage smallint not null default 0 check (stage between 0 and 7),
  due_date date,
  campaign text not null default '',
  hook text not null default '',
  script text not null default '',
  caption text not null default '',
  notes text not null default '',
  inspiration_link text not null default '',
  website_link text not null default '',
  media jsonb not null default '[]'::jsonb,
  checklist jsonb not null default '[]'::jsonb,
  vault_refs uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists content_items_user_id_idx on public.content_items(user_id);
create index if not exists content_items_user_stage_idx on public.content_items(user_id, stage);

alter table public.content_items enable row level security;
drop policy if exists "content_items_owner" on public.content_items;
create policy "content_items_owner" on public.content_items
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop trigger if exists trg_content_items_updated_at on public.content_items;
create trigger trg_content_items_updated_at
  before update on public.content_items
  for each row execute function public.set_updated_at();

-- ============================================================
-- vault_items — Inspiration / Vault ("maison-vault-items")
-- ============================================================
create table if not exists public.vault_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  text text not null default '',
  type text not null default 'Other', -- On-Screen Text / Hook / Caption / CTA / Audio / Other
  pillar text not null default '',
  notes text not null default '',
  platform text not null default '',
  source_url text not null default '',
  tags text[] not null default '{}',
  linked_content_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists vault_items_user_id_idx on public.vault_items(user_id);

alter table public.vault_items enable row level security;
drop policy if exists "vault_items_owner" on public.vault_items;
create policy "vault_items_owner" on public.vault_items
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop trigger if exists trg_vault_items_updated_at on public.vault_items;
create trigger trg_vault_items_updated_at
  before update on public.vault_items
  for each row execute function public.set_updated_at();

-- ============================================================
-- planner_activities — planner.html scheduled items
-- type: 'content' | 'workBlock' | 'deadline'
-- ============================================================
create table if not exists public.planner_activities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('content','workBlock','deadline')),
  content_id uuid references public.content_items(id) on delete set null,
  action text,           -- for type='content': e.g. 'Film', 'Post'
  title text,            -- for type='workBlock' / 'deadline'
  date date not null,
  start_time text,       -- stored as 'HH:MM' to match the existing UI, not a timestamp
  end_time text,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists planner_activities_user_date_idx on public.planner_activities(user_id, date);
create index if not exists planner_activities_content_id_idx on public.planner_activities(content_id);

alter table public.planner_activities enable row level security;
drop policy if exists "planner_activities_owner" on public.planner_activities;
create policy "planner_activities_owner" on public.planner_activities
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop trigger if exists trg_planner_activities_updated_at on public.planner_activities;
create trigger trg_planner_activities_updated_at
  before update on public.planner_activities
  for each row execute function public.set_updated_at();

-- ============================================================
-- planner_routines — planner.html recurring routines
-- ============================================================
create table if not exists public.planner_routines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  day text not null,     -- e.g. 'Mon' — matches the existing UI's day picker
  time text not null,    -- 'HH:MM'
  repeat text not null default 'weekly',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists planner_routines_user_id_idx on public.planner_routines(user_id);

alter table public.planner_routines enable row level security;
drop policy if exists "planner_routines_owner" on public.planner_routines;
create policy "planner_routines_owner" on public.planner_routines
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop trigger if exists trg_planner_routines_updated_at on public.planner_routines;
create trigger trg_planner_routines_updated_at
  before update on public.planner_routines
  for each row execute function public.set_updated_at();

-- ============================================================
-- goals — goals.html ("maison-goals")
-- type: 'activity' | 'outcome' (two very different shapes, kept in one
-- table like the original JSON array; unused columns stay null per row)
-- ============================================================
create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('activity','outcome')),
  category text not null default '',
  name text not null,
  status text not null default 'active',

  -- activity-goal fields
  platform text,
  format text,
  target integer,
  period text default 'week',           -- 'week' | 'month'
  progress_source text,                 -- 'content' | 'routine' | 'manual'
  manual_current integer default 0,
  schedule_note text default '',
  unit_label text,

  -- outcome-goal fields
  current_value numeric,
  target_value numeric,
  unit text,                            -- 'count' | 'currency' | 'percent'
  target_date date,
  is_current_focus boolean default false,
  linked_activity_goal_ids uuid[] not null default '{}',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists goals_user_id_idx on public.goals(user_id);
create index if not exists goals_user_type_idx on public.goals(user_id, type);

alter table public.goals enable row level security;
drop policy if exists "goals_owner" on public.goals;
create policy "goals_owner" on public.goals
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop trigger if exists trg_goals_updated_at on public.goals;
create trigger trg_goals_updated_at
  before update on public.goals
  for each row execute function public.set_updated_at();

-- ============================================================
-- routine_goal_completions — replaces the "<goalId>:<weekStartISO>" map
-- ============================================================
create table if not exists public.routine_goal_completions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  goal_id uuid not null references public.goals(id) on delete cascade,
  week_start date not null,
  completed boolean not null default true,
  created_at timestamptz not null default now(),
  unique (user_id, goal_id, week_start)
);

create index if not exists routine_goal_completions_user_idx on public.routine_goal_completions(user_id);

alter table public.routine_goal_completions enable row level security;
drop policy if exists "routine_goal_completions_owner" on public.routine_goal_completions;
create policy "routine_goal_completions_owner" on public.routine_goal_completions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================================
-- inbox_status — Maison's own tags layered over live Gmail messages
-- ("maison-inbox-status"). Email content itself is never stored here.
-- ============================================================
create table if not exists public.inbox_status (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email_id text not null,   -- Gmail message id
  status text not null,     -- e.g. 'needs-reply' | 'waiting' | 'done'
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, email_id)
);

create index if not exists inbox_status_user_id_idx on public.inbox_status(user_id);

alter table public.inbox_status enable row level security;
drop policy if exists "inbox_status_owner" on public.inbox_status;
create policy "inbox_status_owner" on public.inbox_status
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop trigger if exists trg_inbox_status_updated_at on public.inbox_status;
create trigger trg_inbox_status_updated_at
  before update on public.inbox_status
  for each row execute function public.set_updated_at();

-- ============================================================
-- home_tasks — home.html DEFAULT_STATE.tasks ("maison-home-v2")
-- ============================================================
create table if not exists public.home_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  tag text,                 -- 'content' | 'filming' | 'business' | 'admin' | ...
  tag_label text,
  time text,                 -- 'HH:MM', optional
  done boolean not null default false,
  reason text default '',
  urgent boolean not null default false,
  note text default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists home_tasks_user_id_idx on public.home_tasks(user_id);

alter table public.home_tasks enable row level security;
drop policy if exists "home_tasks_owner" on public.home_tasks;
create policy "home_tasks_owner" on public.home_tasks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop trigger if exists trg_home_tasks_updated_at on public.home_tasks;
create trigger trg_home_tasks_updated_at
  before update on public.home_tasks
  for each row execute function public.set_updated_at();

-- ============================================================
-- home_schedule — home.html DEFAULT_STATE.schedule ("maison-home-v2")
-- ============================================================
create table if not exists public.home_schedule (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  time text not null,       -- 'HH:MM'
  what text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists home_schedule_user_id_idx on public.home_schedule(user_id);

alter table public.home_schedule enable row level security;
drop policy if exists "home_schedule_owner" on public.home_schedule;
create policy "home_schedule_owner" on public.home_schedule
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop trigger if exists trg_home_schedule_updated_at on public.home_schedule;
create trigger trg_home_schedule_updated_at
  before update on public.home_schedule
  for each row execute function public.set_updated_at();
