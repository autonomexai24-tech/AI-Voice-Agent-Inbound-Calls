create extension if not exists pgcrypto;

create table if not exists call_logs (
  id uuid primary key default gen_random_uuid(),
  phone_number text not null,
  start_time timestamptz not null default now(),
  duration integer,
  status text not null default 'started',
  outcome text,
  created_at timestamptz not null default now()
);

create table if not exists transcripts (
  call_id uuid not null references call_logs(id) on delete cascade,
  speaker text not null,
  text text not null,
  timestamp timestamptz not null default now()
);

create table if not exists bookings (
  call_id uuid primary key references call_logs(id) on delete cascade,
  appointment_time timestamptz not null,
  status text not null default 'pending',
  sms_sent boolean not null default false
);

create table if not exists agent_config (
  id uuid primary key default gen_random_uuid(),
  initial_greeting text not null,
  system_prompt text not null,
  vad_threshold numeric(4, 3) not null default 0.500,
  language_code varchar(10) not null default 'en-IN',
  updated_at timestamptz not null default now(),
  constraint agent_config_vad_threshold_range
    check (vad_threshold >= 0 and vad_threshold <= 1)
);

alter table call_logs
  add column if not exists created_at timestamptz not null default now();

alter table agent_config
  add column if not exists language_code varchar(10) not null default 'en-IN';

insert into agent_config (
  initial_greeting,
  system_prompt,
  vad_threshold,
  language_code
)
select
  'Hello, thanks for calling. How can I help you today?',
  'You are a helpful inbound voice agent. Keep responses brief, natural, and focused on helping the caller.',
  0.500,
  'en-IN'
where not exists (
  select 1 from agent_config
);

create index if not exists idx_call_logs_phone_number
  on call_logs(phone_number);

create index if not exists idx_call_logs_start_time
  on call_logs(start_time desc);

create index if not exists idx_call_logs_status
  on call_logs(status);

create index if not exists idx_transcripts_call_id_timestamp
  on transcripts(call_id, timestamp);

create index if not exists idx_bookings_appointment_time
  on bookings(appointment_time);

create index if not exists idx_bookings_status
  on bookings(status);
