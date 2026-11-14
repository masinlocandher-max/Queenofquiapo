-- Edition model, application lifecycle, candidate registry and audit detail.
-- Additive only: no existing row is deleted. Legacy one-vote records are kept and frozen.

-- 1. Editions ---------------------------------------------------------------
create table qoq_private.editions (
  id text primary key check (id ~ '^[a-z0-9-]{3,40}$'),
  name text not null check (length(trim(name)) between 1 and 120),
  theme text,
  timezone text not null default 'Asia/Manila',
  organizer text,
  rules_version text,
  applications_open_at timestamptz,
  applications_close_at timestamptz,
  screening_starts_at timestamptz,
  screening_ends_at timestamptz,
  screening_venue text,           -- null means "to be announced"
  coronation_date date,
  coronation_starts_at timestamptz, -- null means "to be announced"
  coronation_venue text,
  status text not null default 'active' check (status in ('upcoming','active','archived')),
  is_current boolean not null default false
);
create unique index qoq_one_current_edition on qoq_private.editions(is_current) where is_current;
alter table qoq_private.editions enable row level security;
revoke all on qoq_private.editions from public,anon,authenticated;

-- Values mirror config/edition.json (checked by tests/edition-consistency.mjs).
insert into qoq_private.editions(id,name,theme,timezone,organizer,screening_starts_at,screening_ends_at,coronation_date,is_current)
values ('qoq-2027','Queen of Quiapo 2027','A Tribute to Faith, Tradition, and Grace','Asia/Manila','FMB&CO',
  '2027-01-04 15:00:00+08','2027-01-04 21:00:00+08','2027-01-06',true);

create function qoq_private.current_edition() returns text language sql stable
set search_path=pg_catalog,pg_temp as $$ select id from qoq_private.editions where is_current $$;

do $$ declare t text; begin
  foreach t in array array['settings','candidates','judges','criteria','scores','announcements','votes','audit','applications'] loop
    execute format('alter table qoq_private.%I add column edition_id text not null default qoq_private.current_edition() references qoq_private.editions(id)',t);
  end loop;
end $$;

-- 2. Settings: explicit voting lifecycle and release controls ----------------
drop trigger qoq_settings_guard on qoq_private.settings;
alter table qoq_private.settings drop constraint settings_voting_check;
update qoq_private.settings set voting=case voting when 'closed' then 'not_configured' when 'ended' then 'closed' else voting end;
alter table qoq_private.settings alter column voting set default 'not_configured';
alter table qoq_private.settings add constraint settings_voting_check
  check (voting in ('not_configured','scheduled','open','closed','finalized'));
alter table qoq_private.settings
  add column roster_locked_at timestamptz,
  add column scoring_opened_at timestamptz,
  add column scoring_opened_by text,
  add column voting_opens_at timestamptz,
  add column voting_closes_at timestamptz,
  add column voting_opened_at timestamptz,
  add column voting_closed_at timestamptz,
  add column voting_finalized_at timestamptz,
  -- Payment release: both this flag and the Worker deployment flag must be on.
  add column payments_enabled boolean not null default false,
  -- Set only by a database administrator when a provider contract is live. No RPC writes it.
  add column payment_provider text check (payment_provider ~ '^[a-z0-9_]{2,30}$'),
  add column packages_approved_at timestamptz,
  add column points_public boolean not null default false,
  add column results_certified_at timestamptz,
  add column results_certified_by text,
  add column results_published_at timestamptz,
  add column results_scope jsonb,
  add constraint settings_window check (voting_opens_at is null or voting_closes_at is null or voting_closes_at>voting_opens_at);

create or replace function qoq_private.guard_settings() returns trigger language plpgsql
set search_path=pg_catalog,pg_temp as $$
begin
  if tg_op='DELETE' then raise exception 'The current edition cannot be erased' using errcode='55000'; end if;
  if old.voter_salt<>new.voter_salt or old.edition_id<>new.edition_id then raise exception 'Edition identity is fixed' using errcode='55000'; end if;
  if old.phase='locked' and new.finalized_at is distinct from old.finalized_at then raise exception 'Finalization timestamp is immutable' using errcode='55000'; end if;
  if old.voting_finalized_at is not null and new.voting_finalized_at is distinct from old.voting_finalized_at then raise exception 'Voting finalization is immutable' using errcode='55000'; end if;
  if old.results_certified_at is not null and (new.results_certified_at,new.results_certified_by) is distinct from (old.results_certified_at,old.results_certified_by) then
    raise exception 'Certification is immutable' using errcode='55000'; end if;
  if new.phase<>old.phase then
    if old.phase='setup' and new.phase='scoring' then
      if not exists(select 1 from qoq_private.candidates where status='active') or not exists(select 1 from qoq_private.judges) or
         (select coalesce(sum(weight),0) from qoq_private.criteria)<>100 then
        raise exception 'Add candidates and judges, and set criteria weights to 100 percent before opening scoring' using errcode='55000';
      end if;
      new.roster_locked_at:=coalesce(new.roster_locked_at,clock_timestamp());
      new.scoring_opened_at:=clock_timestamp();
    elsif old.phase='scoring' and new.phase='locked' then
      if exists(select 1 from qoq_private.judges where locked_at is null) then raise exception 'Every judge must lock their ballot first' using errcode='55000'; end if;
      new.finalized_at:=clock_timestamp();
    else raise exception 'This scoring transition is not available' using errcode='55000';
    end if;
  end if;
  if new.voting<>old.voting then
    if old.voting in ('not_configured','scheduled') and new.voting='open' then
      if not exists(select 1 from qoq_private.candidates where published and status='active' and number is not null) then
        raise exception 'Publish at least one numbered official candidate before opening voting' using errcode='55000'; end if;
      new.roster_locked_at:=coalesce(new.roster_locked_at,clock_timestamp());
      new.voting_opened_at:=clock_timestamp();
    elsif old.voting='open' and new.voting='closed' then new.voting_closed_at:=clock_timestamp();
    elsif old.voting='closed' and new.voting='finalized' then new.voting_finalized_at:=clock_timestamp();
    elsif not((old.voting,new.voting) in (('not_configured','scheduled'),('scheduled','not_configured'))) then
      raise exception 'This voting transition is not available' using errcode='55000';
    end if;
  end if;
  if old.roster_locked_at is not null and new.roster_locked_at is null and (new.phase<>'setup' or new.voting not in ('not_configured','scheduled')) then
    raise exception 'The roster can no longer be unlocked' using errcode='55000'; end if;
  if new.payments_enabled and (new.payment_provider is null or new.packages_approved_at is null) then
    raise exception 'Payments need a configured provider and an approved package catalog' using errcode='55000'; end if;
  if new.results_published_at is not null and new.results_certified_at is null then
    raise exception 'Results must be certified before publication' using errcode='55000'; end if;
  if new.results_certified_at is not null and new.phase<>'locked' then
    raise exception 'Only a locked tabulation can be certified' using errcode='55000'; end if;
  return new;
end $$;
create trigger qoq_settings_guard before update or delete on qoq_private.settings for each row execute function qoq_private.guard_settings();

-- The one-vote-per-account ballot is retired. Existing rows stay as history; nothing new is accepted.
create or replace function qoq_private.guard_vote() returns trigger language plpgsql
set search_path=pg_catalog,pg_temp as $$
begin raise exception 'The one-vote ballot was retired; legacy votes are read-only' using errcode='55000'; end $$;

-- 3. Candidate registry ------------------------------------------------------
alter table qoq_private.candidates
  add column number int check (number between 1 and 999),
  add column published boolean not null default false,
  add column status text not null default 'active' check (status in ('active','withdrawn')),
  add column bio text check (bio is null or length(bio)<=600),
  add column consent_ref text check (consent_ref is null or length(consent_ref)<=200),
  add column application_ref text,  -- private link to the screening record; never returned publicly
  add column created_at timestamptz not null default now(),
  add column updated_at timestamptz not null default now(),
  add constraint candidates_publication_needs_clearance check (not published or (consent_ref is not null and length(trim(consent_ref))>0 and status='active'));
create unique index qoq_candidate_number on qoq_private.candidates(edition_id,number) where number is not null;
create unique index qoq_candidate_application on qoq_private.candidates(application_ref) where application_ref is not null;

alter table qoq_private.criteria
  add column description text check (description is null or length(description)<=400),
  add column display_order int not null default 0;
alter table qoq_private.judges add column last_seen_at timestamptz;

create or replace function qoq_private.guard_config() returns trigger language plpgsql
set search_path=pg_catalog,pg_temp as $$
declare s qoq_private.settings%rowtype;
begin
  select * into strict s from qoq_private.settings where singleton for share;
  if tg_table_name='judges' and tg_op='UPDATE' then
    if old.actor is not null and old.actor is distinct from new.actor then raise exception 'Judge account binding is fixed' using errcode='55000'; end if;
    if old.locked_at is not null and old is distinct from new then raise exception 'Submitted judge record is locked' using errcode='55000'; end if;
    if (old.id,old.name,old.email) is not distinct from (new.id,new.name,new.email) then
      if old.locked_at is null and new.locked_at is not null then
        if s.phase<>'scoring' or new.actor is null or (select count(*) from qoq_private.scores where judge_id=old.id) <>
          (select count(*) from qoq_private.candidates where status='active')*(select count(*) from qoq_private.criteria) then
          raise exception 'Complete all scores before locking the ballot' using errcode='55000';
        end if;
      end if;
      return new;
    end if;
    if old.actor is not null and old.email is distinct from new.email then raise exception 'A linked judge email cannot be reassigned' using errcode='55000'; end if;
  end if;
  if s.phase<>'setup' or (tg_table_name='candidates' and s.roster_locked_at is not null) then
    raise exception 'This round configuration is frozen' using errcode='55000';
  end if;
  if tg_op='DELETE' then return old; end if;
  if tg_table_name='candidates' then new.updated_at:=clock_timestamp(); end if;
  return new;
end $$;

-- 4. Audit: detail and append-only -------------------------------------------
alter table qoq_private.audit add column details jsonb;
create function qoq_private.guard_append_only() returns trigger language plpgsql
set search_path=pg_catalog,pg_temp as $$
begin raise exception 'This record is append-only' using errcode='55000'; end $$;
create trigger qoq_audit_append_only before update or delete on qoq_private.audit for each row execute function qoq_private.guard_append_only();
create function qoq_private.log(p_actor text,p_action text,p_target uuid,p_details jsonb default null) returns void language sql
set search_path=pg_catalog,pg_temp as $$
  insert into qoq_private.audit(actor,action,target,details) values(coalesce(nullif(p_actor,''),'system'),p_action,p_target,p_details)
$$;

-- 5. Application lifecycle ---------------------------------------------------
alter table qoq_private.applications
  add column status text not null default 'submitted'
    check (status in ('submitted','under_review','correction_requested','qualified','screened','approved','not_selected','withdrawn')),
  add column status_changed_at timestamptz not null default now();
create index qoq_applications_status on qoq_private.applications(edition_id,status,id desc);
create index qoq_applications_email on qoq_private.applications(lower(profile->>'email'));

-- Status changes and reviewer notes. Removed with the application when an applicant's data is erased.
create table qoq_private.application_events (
  id bigint generated always as identity primary key,
  application_id bigint not null references qoq_private.applications(id) on delete cascade,
  occurred_at timestamptz not null default now(),
  actor text not null,
  kind text not null check (kind in ('status','note')),
  from_status text,
  to_status text,
  note text check (note is null or length(note)<=1000)
);
create index qoq_application_events_app on qoq_private.application_events(application_id,id);
alter table qoq_private.application_events enable row level security;
revoke all on qoq_private.application_events from public,anon,authenticated;

create function qoq_private.application_transition_ok(a text,b text) returns boolean language sql immutable
set search_path=pg_catalog,pg_temp as $$
  select (a,b) in (
    ('submitted','under_review'),('submitted','withdrawn'),
    ('under_review','correction_requested'),('under_review','qualified'),('under_review','not_selected'),('under_review','withdrawn'),
    ('correction_requested','under_review'),('correction_requested','not_selected'),('correction_requested','withdrawn'),
    ('qualified','screened'),('qualified','not_selected'),('qualified','withdrawn'),
    ('screened','approved'),('screened','not_selected'),('screened','withdrawn'),
    ('approved','withdrawn'),
    ('not_selected','under_review'))
$$;

create or replace function public.qoq_intake(p_secret text,p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp
as $$
declare
  a qoq_private.applications%rowtype;
  e qoq_private.editions%rowtype;
  cap int; last_id bigint; page_rows jsonb; has_more boolean;
  actor text:=left(trim(coalesce(p_data->>'actor','')),200);
  want text; q text; note text; cand uuid; oldest boolean;
begin
  if not public.qoq_media_authorized(p_secret) then raise exception 'Access denied' using errcode='42501'; end if;
  if jsonb_typeof(p_data) is distinct from 'object' or pg_column_size(p_data)>32768 then
    raise exception 'Invalid payload' using errcode='22023';
  end if;
  case p_action
  when 'find' then
    select * into a from qoq_private.applications where request_key=p_data->>'requestKey';
    if not found then return '{}'::jsonb; end if;
    return jsonb_build_object('reference',a.reference,'fingerprint',a.fingerprint,'submittedAt',a.submitted_at);
  when 'create' then
    select * into strict e from qoq_private.editions where is_current;
    if (e.applications_open_at is not null and clock_timestamp()<e.applications_open_at)
       or (e.applications_close_at is not null and clock_timestamp()>=e.applications_close_at) then
      raise exception 'Applications are not open at this time' using errcode='55000';
    end if;
    insert into qoq_private.applications(reference,request_key,fingerprint,storage_key,profile,portrait_type,swimsuit_type)
    values(p_data->>'reference',p_data->>'requestKey',p_data->>'fingerprint',(p_data->>'storageKey')::uuid,p_data->'profile',p_data->>'portraitType',p_data->>'swimsuitType')
    on conflict(request_key) do nothing returning * into a;
    if not found then return '{}'::jsonb; end if;
    return jsonb_build_object('reference',a.reference,'submittedAt',a.submitted_at,'edition',e.name);
  when 'withdrawal' then
    select * into a from qoq_private.applications where reference=p_data->>'reference' and request_key=p_data->>'requestKey';
    if not found then return '{}'::jsonb; end if;
    return jsonb_build_object('reference',a.reference,'storageKey',a.storage_key);
  when 'details' then
    select * into a from qoq_private.applications where reference=p_data->>'reference';
    if not found then return '{}'::jsonb; end if;
    return a.profile || jsonb_build_object('reference',a.reference,'submittedAt',a.submitted_at,'storageKey',a.storage_key,
      'portraitType',a.portrait_type,'swimsuitType',a.swimsuit_type,'status',a.status,'statusChangedAt',a.status_changed_at,
      'candidateId',(select id from qoq_private.candidates where application_ref=a.reference),
      'history',(select coalesce(jsonb_agg(jsonb_build_object('at',occurred_at,'actor',ev.actor,'kind',kind,'from',from_status,'to',to_status,'note',ev.note) order by ev.id),'[]')
        from qoq_private.application_events ev where application_id=a.id),
      'duplicates',(select coalesce(jsonb_agg(d.reference order by d.id),'[]') from qoq_private.applications d
        where d.id<>a.id and (lower(d.profile->>'email')=lower(a.profile->>'email')
          or (coalesce(a.profile->>'mobile','')<>'' and d.profile->>'mobile'=a.profile->>'mobile'))));
  when 'remove' then
    delete from qoq_private.applications where reference=p_data->>'reference' and storage_key=(p_data->>'storageKey')::uuid;
    if found then perform qoq_private.log(coalesce(nullif(actor,''),'applicant'),'application.removed',null,jsonb_build_object('reference',p_data->>'reference')); end if;
    return jsonb_build_object('ok',true);
  when 'list' then
    cap:=coalesce((p_data->>'limit')::integer,25);
    oldest:=coalesce(p_data->>'sort','newest')='oldest';
    last_id:=coalesce((p_data->>'cursor')::bigint,case when oldest then 0 else 9223372036854775807 end);
    want:=nullif(p_data->>'status','');
    q:=nullif(trim(coalesce(p_data->>'q','')),'');
    if cap not between 1 and 50 or last_id<0 or length(coalesce(q,''))>120 then raise exception 'Invalid page' using errcode='22023'; end if;
    if q is not null then q:='%'||replace(replace(replace(q,'\','\\'),'%','\%'),'_','\_')||'%'; end if;
    with batch as (
      select id,jsonb_build_object('reference',reference,'femaleName',profile->>'femaleName','locality',profile->>'locality','submittedAt',submitted_at,'status',status,
        'duplicate',exists(select 1 from qoq_private.applications d where d.id<>x.id and lower(d.profile->>'email')=lower(x.profile->>'email'))) as entry
      from qoq_private.applications x
      where (case when oldest then id>last_id else id<last_id end) and (want is null or status=want)
        and (q is null or reference ilike q or profile->>'femaleName' ilike q or profile->>'legalName' ilike q or profile->>'email' ilike q or profile->>'locality' ilike q)
      order by case when oldest then id end asc, case when not oldest then id end desc limit cap+1
    ), selected as (select * from batch order by case when oldest then id end asc, case when not oldest then id end desc limit cap)
    select coalesce(jsonb_agg(entry order by case when oldest then id end asc, case when not oldest then id end desc),'[]'::jsonb),
      case when oldest then max(id) else min(id) end,(select count(*)>cap from batch)
      into page_rows,last_id,has_more from selected;
    return jsonb_build_object('applications',page_rows,'nextCursor',case when has_more then last_id else null end,
      'counts',(select coalesce(jsonb_object_agg(status,n),'{}') from (select status,count(*) n from qoq_private.applications group by status) c),
      'total',(select count(*) from qoq_private.applications));
  when 'setStatus' then
    want:=p_data->>'status'; note:=nullif(trim(coalesce(p_data->>'note','')),'');
    if actor='' then raise exception 'Reviewer identity required' using errcode='42501'; end if;
    select * into a from qoq_private.applications where reference=p_data->>'reference' for update;
    if not found then raise exception 'Application not found' using errcode='22023'; end if;
    if length(coalesce(note,''))>1000 then raise exception 'Keep the note under 1000 characters' using errcode='22023'; end if;
    if not coalesce(qoq_private.application_transition_ok(a.status,want),false) then
      raise exception 'That status change is not allowed from the current status' using errcode='55000'; end if;
    update qoq_private.applications set status=want,status_changed_at=clock_timestamp() where id=a.id;
    insert into qoq_private.application_events(application_id,actor,kind,from_status,to_status,note) values(a.id,actor,'status',a.status,want,note);
    perform qoq_private.log(actor,'application.status',null,jsonb_build_object('reference',a.reference,'from',a.status,'to',want));
    return jsonb_build_object('ok',true,'status',want);
  when 'note' then
    note:=nullif(trim(coalesce(p_data->>'note','')),'');
    if actor='' then raise exception 'Reviewer identity required' using errcode='42501'; end if;
    if note is null or length(note)>1000 then raise exception 'Enter a note of up to 1000 characters' using errcode='22023'; end if;
    select * into a from qoq_private.applications where reference=p_data->>'reference';
    if not found then raise exception 'Application not found' using errcode='22023'; end if;
    insert into qoq_private.application_events(application_id,actor,kind,note) values(a.id,actor,'note',note);
    return jsonb_build_object('ok',true);
  when 'promote' then
    -- Applicant to official candidate. Only the approved pageant name crosses over; no contact detail,
    -- measurement or screening photograph is copied, and the new entry starts unpublished.
    if actor='' then raise exception 'Reviewer identity required' using errcode='42501'; end if;
    perform 1 from qoq_private.settings where singleton for update;
    select * into a from qoq_private.applications where reference=p_data->>'reference' for update;
    if not found then raise exception 'Application not found' using errcode='22023'; end if;
    if a.status<>'approved' then raise exception 'Approve the application before adding the candidate to the roster' using errcode='55000'; end if;
    if exists(select 1 from qoq_private.candidates where application_ref=a.reference) then
      raise exception 'This applicant is already on the official roster' using errcode='23505'; end if;
    insert into qoq_private.candidates(name,application_ref) values(trim(a.profile->>'femaleName'),a.reference) returning id into cand;
    perform qoq_private.log(actor,'application.promoted',cand,jsonb_build_object('reference',a.reference));
    return jsonb_build_object('ok',true,'candidateId',cand);
  when 'export' then
    if actor='' then raise exception 'Reviewer identity required' using errcode='42501'; end if;
    perform qoq_private.log(actor,'application.export',null,jsonb_build_object('rows',(select count(*) from qoq_private.applications)));
    return jsonb_build_object('rows',(select coalesce(jsonb_agg(profile-'consentVersion'||jsonb_build_object('reference',reference,'submittedAt',submitted_at,'status',status) order by id),'[]')
      from (select * from qoq_private.applications order by id limit 5000) x));
  else raise exception 'Unknown action' using errcode='22023';
  end case;
end $$;
revoke all on function public.qoq_intake(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.qoq_intake(text,text,jsonb) to anon,service_role;

revoke all on all functions in schema qoq_private from public,anon,authenticated;
