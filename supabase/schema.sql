-- StartFlow cloud persistence.
-- Run this in the Supabase SQL editor for the project used by Vercel.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  wake text not null default '07:30',
  sleep text not null default '23:30',
  min_block integer not null default 25 check (min_block >= 10),
  max_block integer not null default 90 check (max_block >= 10),
  daily_buffer integer not null default 30 check (daily_buffer >= 0),
  deadline_buffer_hours integer not null default 2 check (deadline_buffer_hours >= 0),
  updated_at timestamptz not null default now(),
  check (min_block <= max_block)
);

create table if not exists public.tasks (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  title text not null,
  duration integer not null check (duration >= 0),
  done_minutes integer not null default 0 check (done_minutes >= 0),
  deadline timestamptz not null,
  mode text not null default 'auto' check (mode in ('auto', 'single', 'split')),
  depends_on text,
  min_block integer check (min_block is null or min_block >= 10),
  max_block integer check (max_block is null or max_block >= 10),
  start_hint text not null default '',
  missed_count integer not null default 0 check (missed_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  check (done_minutes <= duration),
  check (min_block is null or max_block is null or min_block <= max_block)
);

create index if not exists tasks_user_deadline_idx on public.tasks(user_id, deadline);

create table if not exists public.events (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  title text not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  repeating boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  check (end_at > start_at)
);

create index if not exists events_user_start_idx on public.events(user_id, start_at);

create table if not exists public.task_history (
  user_id uuid not null,
  task_id text not null,
  id text not null,
  label text not null,
  minutes integer not null default 0 check (minutes >= 0),
  happened_at timestamptz not null default now(),
  primary key (user_id, task_id, id),
  foreign key (user_id, task_id) references public.tasks(user_id, id) on delete cascade
);

create index if not exists task_history_task_idx on public.task_history(user_id, task_id, happened_at);

do $$
declare
  table_name text;
begin
  foreach table_name in array array['user_settings', 'tasks', 'events', 'task_history']
  loop
    execute format('alter table public.%I enable row level security', table_name);
  end loop;
end $$;

drop policy if exists "Users can select their settings" on public.user_settings;
create policy "Users can select their settings"
  on public.user_settings for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their settings" on public.user_settings;
create policy "Users can insert their settings"
  on public.user_settings for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their settings" on public.user_settings;
create policy "Users can update their settings"
  on public.user_settings for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete their settings" on public.user_settings;
create policy "Users can delete their settings"
  on public.user_settings for delete to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can select their tasks" on public.tasks;
create policy "Users can select their tasks"
  on public.tasks for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their tasks" on public.tasks;
create policy "Users can insert their tasks"
  on public.tasks for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their tasks" on public.tasks;
create policy "Users can update their tasks"
  on public.tasks for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete their tasks" on public.tasks;
create policy "Users can delete their tasks"
  on public.tasks for delete to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can select their events" on public.events;
create policy "Users can select their events"
  on public.events for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their events" on public.events;
create policy "Users can insert their events"
  on public.events for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their events" on public.events;
create policy "Users can update their events"
  on public.events for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete their events" on public.events;
create policy "Users can delete their events"
  on public.events for delete to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can select their task history" on public.task_history;
create policy "Users can select their task history"
  on public.task_history for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their task history" on public.task_history;
create policy "Users can insert their task history"
  on public.task_history for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their task history" on public.task_history;
create policy "Users can update their task history"
  on public.task_history for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete their task history" on public.task_history;
create policy "Users can delete their task history"
  on public.task_history for delete to authenticated
  using (auth.uid() = user_id);

drop trigger if exists user_settings_set_updated_at on public.user_settings;
create trigger user_settings_set_updated_at
  before update on public.user_settings
  for each row execute function public.set_updated_at();

drop trigger if exists tasks_set_updated_at on public.tasks;
create trigger tasks_set_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();

drop trigger if exists events_set_updated_at on public.events;
create trigger events_set_updated_at
  before update on public.events
  for each row execute function public.set_updated_at();

create or replace function public.save_startflow_state(input_state jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'StartFlow save requires an authenticated user.';
  end if;

  insert into public.user_settings (
    user_id,
    wake,
    sleep,
    min_block,
    max_block,
    daily_buffer,
    deadline_buffer_hours
  )
  values (
    current_user_id,
    coalesce(input_state #>> '{settings,wake}', '07:30'),
    coalesce(input_state #>> '{settings,sleep}', '23:30'),
    coalesce((input_state #>> '{settings,minBlock}')::integer, 25),
    coalesce((input_state #>> '{settings,maxBlock}')::integer, 90),
    coalesce((input_state #>> '{settings,dailyBuffer}')::integer, 30),
    coalesce((input_state #>> '{settings,deadlineBufferHours}')::integer, 2)
  )
  on conflict (user_id) do update set
    wake = excluded.wake,
    sleep = excluded.sleep,
    min_block = excluded.min_block,
    max_block = excluded.max_block,
    daily_buffer = excluded.daily_buffer,
    deadline_buffer_hours = excluded.deadline_buffer_hours;

  insert into public.tasks (
    user_id,
    id,
    title,
    duration,
    done_minutes,
    deadline,
    mode,
    depends_on,
    min_block,
    max_block,
    start_hint,
    missed_count
  )
  select
    current_user_id,
    task_item->>'id',
    coalesce(task_item->>'title', '未命名任务'),
    coalesce((task_item->>'duration')::integer, 0),
    least(coalesce((task_item->>'doneMinutes')::integer, 0), coalesce((task_item->>'duration')::integer, 0)),
    (task_item->>'deadline')::timestamptz,
    coalesce(task_item->>'mode', 'auto'),
    nullif(task_item->>'dependsOn', ''),
    nullif(task_item->>'minBlock', '')::integer,
    nullif(task_item->>'maxBlock', '')::integer,
    coalesce(task_item->>'startHint', ''),
    coalesce((task_item->>'missedCount')::integer, 0)
  from jsonb_array_elements(coalesce(input_state->'tasks', '[]'::jsonb)) as task_item
  where task_item ? 'id'
  on conflict (user_id, id) do update set
    title = excluded.title,
    duration = excluded.duration,
    done_minutes = excluded.done_minutes,
    deadline = excluded.deadline,
    mode = excluded.mode,
    depends_on = excluded.depends_on,
    min_block = excluded.min_block,
    max_block = excluded.max_block,
    start_hint = excluded.start_hint,
    missed_count = excluded.missed_count;

  delete from public.task_history
  where user_id = current_user_id;

  insert into public.task_history (
    user_id,
    task_id,
    id,
    label,
    minutes,
    happened_at
  )
  select
    current_user_id,
    task_item->>'id',
    history_item->>'id',
    coalesce(history_item->>'label', ''),
    coalesce((history_item->>'minutes')::integer, 0),
    coalesce((history_item->>'at')::timestamptz, now())
  from jsonb_array_elements(coalesce(input_state->'tasks', '[]'::jsonb)) as task_item
  cross join jsonb_array_elements(coalesce(task_item->'history', '[]'::jsonb)) as history_item
  where task_item ? 'id'
    and history_item ? 'id';

  insert into public.events (
    user_id,
    id,
    title,
    start_at,
    end_at,
    repeating
  )
  select
    current_user_id,
    event_item->>'id',
    coalesce(event_item->>'title', '未命名日程'),
    (event_item->>'start')::timestamptz,
    (event_item->>'end')::timestamptz,
    coalesce((event_item->>'repeating')::boolean, false)
  from jsonb_array_elements(coalesce(input_state->'events', '[]'::jsonb)) as event_item
  where event_item ? 'id'
  on conflict (user_id, id) do update set
    title = excluded.title,
    start_at = excluded.start_at,
    end_at = excluded.end_at,
    repeating = excluded.repeating;

  delete from public.events existing
  where existing.user_id = current_user_id
    and not exists (
      select 1
      from jsonb_array_elements(coalesce(input_state->'events', '[]'::jsonb)) as event_item
      where event_item->>'id' = existing.id
    );

  delete from public.tasks existing
  where existing.user_id = current_user_id
    and not exists (
      select 1
      from jsonb_array_elements(coalesce(input_state->'tasks', '[]'::jsonb)) as task_item
      where task_item->>'id' = existing.id
    );
end;
$$;

grant execute on function public.save_startflow_state(jsonb) to authenticated;
