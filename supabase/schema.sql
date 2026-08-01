create extension if not exists "pgcrypto";

create type app_role as enum ('teacher', 'student', 'guardian');
create type goal_type as enum ('year', 'month', 'week');
create type schedule_category as enum ('school', 'practice', 'lesson', 'homework', 'rest');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role app_role not null default 'student',
  full_name text not null,
  created_at timestamptz not null default now()
);

create table public.students (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete set null,
  full_name text not null,
  instrument text,
  grade_level text,
  self_payer boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.guardian_students (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  guardian_id uuid not null references public.profiles(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  relationship text,
  created_at timestamptz not null default now(),
  unique (guardian_id, student_id)
);

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  type goal_type not null,
  title text not null,
  detail text,
  due_date date,
  progress integer not null default 0 check (progress between 0 and 100),
  done boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.schedules (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 1 and 7),
  starts_at time not null,
  title text not null,
  category schedule_category not null default 'practice',
  done boolean not null default false,
  created_at timestamptz not null default now(),
  unique (student_id, day_of_week, starts_at)
);

create table public.practice_logs (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  goal_id uuid references public.goals(id) on delete set null,
  practiced_on date not null,
  minutes integer not null default 0 check (minutes >= 0),
  achieved boolean not null default false,
  photo_path text,
  material_link text,
  notes text,
  created_at timestamptz not null default now()
);

create table public.lessons (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  lesson_on date not null,
  content text,
  assignment text,
  assignment_due date,
  feedback text,
  student_memo text,
  created_at timestamptz not null default now()
);

create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  lesson_id uuid references public.lessons(id) on delete cascade,
  title text not null,
  due_date date,
  feedback text,
  completed boolean not null default false,
  completed_at date,
  created_at timestamptz not null default now()
);

create table public.tuition_payments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  cycle_no integer not null check (cycle_no > 0),
  lesson_from integer not null check (lesson_from > 0),
  lesson_to integer not null check (lesson_to >= lesson_from),
  paid boolean not null default false,
  paid_at date,
  memo text,
  created_at timestamptz not null default now(),
  unique (student_id, cycle_no)
);

create table public.weekly_reviews (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  week_start date not null,
  schedule_result text,
  reflection text,
  self_feedback text,
  teacher_feedback text,
  created_at timestamptz not null default now(),
  unique (student_id, week_start)
);

create index goals_student_id_idx on public.goals(student_id);
create index guardian_students_guardian_id_idx on public.guardian_students(guardian_id);
create index guardian_students_student_id_idx on public.guardian_students(student_id);
create index schedules_student_id_idx on public.schedules(student_id);
create index practice_logs_student_date_idx on public.practice_logs(student_id, practiced_on desc);
create index lessons_student_date_idx on public.lessons(student_id, lesson_on desc);
create index assignments_student_id_idx on public.assignments(student_id);
create index tuition_payments_student_id_idx on public.tuition_payments(student_id);
create index weekly_reviews_student_week_idx on public.weekly_reviews(student_id, week_start desc);

alter table public.profiles enable row level security;
alter table public.students enable row level security;
alter table public.guardian_students enable row level security;
alter table public.goals enable row level security;
alter table public.schedules enable row level security;
alter table public.practice_logs enable row level security;
alter table public.lessons enable row level security;
alter table public.assignments enable row level security;
alter table public.tuition_payments enable row level security;
alter table public.weekly_reviews enable row level security;

create or replace function public.is_teacher_for_student(target_student_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.students s
    where s.id = target_student_id
      and s.teacher_id = auth.uid()
  );
$$;

create or replace function public.is_student_profile(target_student_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.students s
    where s.id = target_student_id
      and s.profile_id = auth.uid()
  );
$$;

create or replace function public.is_self_payer_student(target_student_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.students s
    where s.id = target_student_id
      and s.profile_id = auth.uid()
      and s.self_payer = true
  );
$$;

create or replace function public.is_guardian_for_student(target_student_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.guardian_students gs
    where gs.student_id = target_student_id
      and gs.guardian_id = auth.uid()
  );
$$;

create policy "profiles can read self"
on public.profiles for select
using (id = auth.uid());

create policy "teachers can manage their students"
on public.students for all
using (teacher_id = auth.uid())
with check (teacher_id = auth.uid());

create policy "students can read their student row"
on public.students for select
using (profile_id = auth.uid());

create policy "guardians can read matched students"
on public.students for select
using (public.is_guardian_for_student(id));

create policy "teachers can manage guardian matches"
on public.guardian_students for all
using (teacher_id = auth.uid())
with check (teacher_id = auth.uid());

create policy "guardians can read own matches"
on public.guardian_students for select
using (guardian_id = auth.uid());

create policy "goals visible to owner or teacher"
on public.goals for select
using (
  public.is_teacher_for_student(student_id)
  or public.is_student_profile(student_id)
  or public.is_guardian_for_student(student_id)
);

create policy "goals writable by owner or teacher"
on public.goals for all
using (public.is_teacher_for_student(student_id) or public.is_student_profile(student_id))
with check (public.is_teacher_for_student(student_id) or public.is_student_profile(student_id));

create policy "schedules visible to owner or teacher"
on public.schedules for select
using (
  public.is_teacher_for_student(student_id)
  or public.is_student_profile(student_id)
  or public.is_guardian_for_student(student_id)
);

create policy "schedules writable by owner or teacher"
on public.schedules for all
using (public.is_teacher_for_student(student_id) or public.is_student_profile(student_id))
with check (public.is_teacher_for_student(student_id) or public.is_student_profile(student_id));

create policy "practice logs visible to owner or teacher"
on public.practice_logs for select
using (
  public.is_teacher_for_student(student_id)
  or public.is_student_profile(student_id)
  or public.is_guardian_for_student(student_id)
);

create policy "practice logs writable by owner or teacher"
on public.practice_logs for all
using (public.is_teacher_for_student(student_id) or public.is_student_profile(student_id))
with check (public.is_teacher_for_student(student_id) or public.is_student_profile(student_id));

create policy "lessons visible to owner or teacher"
on public.lessons for select
using (
  public.is_teacher_for_student(student_id)
  or public.is_student_profile(student_id)
  or public.is_guardian_for_student(student_id)
);

create policy "lessons writable by teacher"
on public.lessons for all
using (public.is_teacher_for_student(student_id))
with check (public.is_teacher_for_student(student_id));

create policy "assignments visible to owner or teacher"
on public.assignments for select
using (
  public.is_teacher_for_student(student_id)
  or public.is_student_profile(student_id)
  or public.is_guardian_for_student(student_id)
);

create policy "assignments writable by owner or teacher"
on public.assignments for all
using (public.is_teacher_for_student(student_id) or public.is_student_profile(student_id))
with check (public.is_teacher_for_student(student_id) or public.is_student_profile(student_id));

create policy "tuition payments visible to teacher guardian or self payer"
on public.tuition_payments for select
using (
  public.is_teacher_for_student(student_id)
  or public.is_self_payer_student(student_id)
  or public.is_guardian_for_student(student_id)
);

create policy "tuition payments writable by teacher"
on public.tuition_payments for all
using (public.is_teacher_for_student(student_id))
with check (public.is_teacher_for_student(student_id));

create policy "weekly reviews visible to owner or teacher"
on public.weekly_reviews for select
using (
  public.is_teacher_for_student(student_id)
  or public.is_student_profile(student_id)
  or public.is_guardian_for_student(student_id)
);

create policy "weekly reviews writable by owner or teacher"
on public.weekly_reviews for all
using (public.is_teacher_for_student(student_id) or public.is_student_profile(student_id))
with check (public.is_teacher_for_student(student_id) or public.is_student_profile(student_id));
