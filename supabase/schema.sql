-- StartFlow cloud persistence.
-- Run this in the Supabase SQL editor for the project used by Vercel.

create table if not exists public.user_states (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{"version":1,"settings":{},"tasks":[],"events":[]}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_states enable row level security;

drop policy if exists "Users can read their own StartFlow state" on public.user_states;
create policy "Users can read their own StartFlow state"
  on public.user_states
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their own StartFlow state" on public.user_states;
create policy "Users can insert their own StartFlow state"
  on public.user_states
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own StartFlow state" on public.user_states;
create policy "Users can update their own StartFlow state"
  on public.user_states
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_states_set_updated_at on public.user_states;
create trigger user_states_set_updated_at
  before update on public.user_states
  for each row
  execute function public.set_updated_at();
