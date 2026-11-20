-- One live pageant edition. An archived/new edition requires an explicit migration.
-- Only the Worker has the secret. Browser roles have no table or schema access.
create schema qoq_private;
revoke all on schema qoq_private from public, anon, authenticated;
alter default privileges in schema qoq_private revoke execute on functions from public;
create table qoq_private.settings (
  singleton boolean primary key default true check (singleton),
  secret_hash text not null check (secret_hash ~ '^[a-f0-9]{64}$'),
  voter_salt uuid not null default gen_random_uuid(),
  phase text not null default 'setup' check (phase in ('setup','scoring','locked')),
  voting text not null default 'closed' check (voting in ('closed','open','ended')),
  finalized_at timestamptz
);
create table qoq_private.candidates (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  photo_key uuid
);
create unique index qoq_candidates_photo on qoq_private.candidates(photo_key) where photo_key is not null;
create table qoq_private.judges (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  email text not null unique check (length(email)<=254 and email=lower(trim(email)) and email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'),
  actor text unique,
  locked_at timestamptz
);
create table qoq_private.criteria (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 100),
  weight numeric not null check (weight>0 and weight<=100 and scale(weight)<=2)
);
create unique index qoq_criterion_name on qoq_private.criteria(lower(trim(name)));
create table qoq_private.scores (
  judge_id uuid not null references qoq_private.judges(id),
  candidate_id uuid not null references qoq_private.candidates(id),
  criterion_id uuid not null references qoq_private.criteria(id),
  score numeric not null check (score between 0 and 100 and scale(score)<=2),
  primary key(judge_id,candidate_id,criterion_id)
);
create table qoq_private.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 1 and 140),
  body text not null check (length(trim(body)) between 1 and 2400),
  published boolean not null default false,
  updated_at timestamptz not null default now()
);
create table qoq_private.votes (
  actor_hash text primary key,
  email_hash text not null unique,
  candidate_id uuid not null references qoq_private.candidates(id),
  created_at timestamptz not null default now()
);
create index qoq_votes_candidate on qoq_private.votes(candidate_id);
create table qoq_private.audit (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor text not null,
  action text not null,
  target uuid
);
-- Locks are also checked by triggers. A second statement cannot change a submitted ballot.
create function qoq_private.guard_score() returns trigger language plpgsql
set search_path=pg_catalog,pg_temp as $$
declare j uuid; locked timestamptz;
begin
  j:=case when tg_op='DELETE' then old.judge_id else new.judge_id end;
  if (select phase from qoq_private.settings where singleton for share) is distinct from 'scoring' then
    raise exception 'Scoring is not open' using errcode='55000';
  end if;
  select locked_at into locked from qoq_private.judges where id=j for update;
  if not found or locked is not null then raise exception 'This ballot is locked or unavailable' using errcode='55000'; end if;
  if tg_op='UPDATE' and (old.judge_id,old.candidate_id,old.criterion_id) is distinct from (new.judge_id,new.candidate_id,new.criterion_id) then
    raise exception 'Ballot ownership cannot be changed' using errcode='55000';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger qoq_score_guard before insert or update or delete on qoq_private.scores
for each row execute function qoq_private.guard_score();

create function qoq_private.guard_config() returns trigger language plpgsql
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
          (select count(*) from qoq_private.candidates)*(select count(*) from qoq_private.criteria) then
          raise exception 'Complete all scores before locking the ballot' using errcode='55000';
        end if;
      end if;
      return new;
    end if;
    if old.actor is not null and old.email is distinct from new.email then raise exception 'A linked judge email cannot be reassigned' using errcode='55000'; end if;
  end if;
  if s.phase<>'setup' or (tg_table_name='candidates' and s.voting<>'closed') then
    raise exception 'This round configuration is frozen' using errcode='55000';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger qoq_candidates_guard before insert or update or delete on qoq_private.candidates for each row execute function qoq_private.guard_config();
create trigger qoq_judges_guard before insert or update or delete on qoq_private.judges for each row execute function qoq_private.guard_config();
create trigger qoq_criteria_guard before insert or update or delete on qoq_private.criteria for each row execute function qoq_private.guard_config();

create function qoq_private.guard_settings() returns trigger language plpgsql
set search_path=pg_catalog,pg_temp as $$
begin
  if tg_op='DELETE' then raise exception 'The current edition cannot be erased' using errcode='55000'; end if;
  if old.voter_salt<>new.voter_salt then raise exception 'Voting identity salt is fixed' using errcode='55000'; end if;
  if old.phase='locked' and new.finalized_at is distinct from old.finalized_at then raise exception 'Finalization timestamp is immutable' using errcode='55000'; end if;
  if new.phase<>old.phase then
    if old.phase='setup' and new.phase='scoring' then
      if not exists(select 1 from qoq_private.candidates) or not exists(select 1 from qoq_private.judges) or
         (select coalesce(sum(weight),0) from qoq_private.criteria)<>100 then
        raise exception 'Add candidates and judges, and set criteria weights to 100 percent before opening scoring' using errcode='55000';
      end if;
    elsif old.phase='scoring' and new.phase='locked' then
      if exists(select 1 from qoq_private.judges where locked_at is null) then raise exception 'Every judge must lock their ballot first' using errcode='55000'; end if;
      new.finalized_at:=clock_timestamp();
    else raise exception 'This scoring transition is not available' using errcode='55000';
    end if;
  end if;
  if new.voting<>old.voting then
    if old.voting='closed' and new.voting='open' then
      if not exists(select 1 from qoq_private.candidates) then raise exception 'Official candidates are required to open voting' using errcode='55000'; end if;
    elsif not(old.voting='open' and new.voting='ended') then raise exception 'This voting transition is not available' using errcode='55000';
    end if;
  end if;
  return new;
end $$;
create trigger qoq_settings_guard before update or delete on qoq_private.settings for each row execute function qoq_private.guard_settings();

create function qoq_private.guard_vote() returns trigger language plpgsql
set search_path=pg_catalog,pg_temp as $$
begin
  if tg_op<>'INSERT' or (select voting from qoq_private.settings where singleton for share) is distinct from 'open' then
    raise exception 'Voting is closed or the vote is immutable' using errcode='55000';
  end if;
  return new;
end $$;
create trigger qoq_vote_guard before insert or update or delete on qoq_private.votes for each row execute function qoq_private.guard_vote();

create function qoq_private.candidate_list() returns jsonb language sql stable set search_path=pg_catalog,pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'photoKey',photo_key) order by name,id),'[]') from qoq_private.candidates
$$;
create function qoq_private.criterion_list() returns jsonb language sql stable set search_path=pg_catalog,pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'weight',weight) order by name,id),'[]') from qoq_private.criteria
$$;
create function qoq_private.score_list(j uuid) returns jsonb language sql stable set search_path=pg_catalog,pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('candidateId',candidate_id,'criterionId',criterion_id,'score',score) order by candidate_id,criterion_id),'[]')
  from qoq_private.scores where judge_id=j
$$;
create function qoq_private.news(include_drafts boolean) returns jsonb language sql stable set search_path=pg_catalog,pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'body',body,'published',published,'updatedAt',updated_at) order by updated_at desc,id)
    filter (where include_drafts or published),'[]') from qoq_private.announcements
$$;
create function qoq_private.dashboard() returns jsonb language sql stable set search_path=pg_catalog,pg_temp as $$
  select jsonb_build_object(
    'round',jsonb_build_object('phase',r.phase,'voting',r.voting),
    'candidates',qoq_private.candidate_list(),'criteria',qoq_private.criterion_list(),'announcements',qoq_private.news(true),
    'voteCounts',(select coalesce(jsonb_agg(jsonb_build_object('candidateId',vc.id,'count',vc.n) order by vc.id),'[]')
      from (select c.id,count(v.actor_hash) n from qoq_private.candidates c left join qoq_private.votes v on v.candidate_id=c.id group by c.id) vc),
    'judges',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'email',email,'locked',locked_at is not null) order by name,id),'[]') from qoq_private.judges),
    'tabulation',jsonb_build_object(
       'pending',(select count(*) from qoq_private.judges where locked_at is null),
       'total',(select count(*) from qoq_private.judges),'final',r.phase='locked','finalizedAt',r.finalized_at,
       'ballots',(select coalesce(jsonb_agg(jsonb_build_object('judgeId',j.id,'judgeName',j.name,'lockedAt',j.locked_at,'scores',qoq_private.score_list(j.id)) order by j.name,j.id),'[]') from qoq_private.judges j where j.locked_at is not null),
       'results',(select coalesce(jsonb_agg(jsonb_build_object('candidateId',id,'name',name,'score',weighted) order by weighted desc,name,id),'[]') from
          (select c.id,c.name,round(sum(b.score*k.weight)/100/count(distinct b.judge_id),2) as weighted
           from qoq_private.scores b join qoq_private.criteria k on k.id=b.criterion_id
           join qoq_private.candidates c on c.id=b.candidate_id join qoq_private.judges j on j.id=b.judge_id
           where j.locked_at is not null group by c.id,c.name) v)))
  from qoq_private.settings r where r.singleton
$$;

create function public.qoq_operations(p_secret text,p_actor text,p_email text,p_organizer boolean,p_action text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare
  s qoq_private.settings%rowtype; j qoq_private.judges%rowtype; item uuid; candidate uuid;
  n text; mail text:=lower(trim(coalesce(p_email,''))); actor text:=trim(coalesce(p_actor,''));
  msg text; score_count int; affected int; photo uuid;
begin
  if p_secret is null or length(p_secret) not between 32 and 512 then raise exception 'Access denied' using errcode='42501'; end if;
  if not exists(select 1 from qoq_private.settings where singleton and secret_hash=encode(sha256(convert_to(p_secret,'utf8')),'hex')) then
    raise exception 'Access denied' using errcode='42501';
  end if;
  if p_action is null or jsonb_typeof(coalesce(p_data,'{}'))<>'object' or octet_length(coalesce(p_data,'{}')::text)>350000 then raise exception 'Invalid request data' using errcode='22023'; end if;
  p_data:=coalesce(p_data,'{}');
  if p_action like 'organizer.%' and (p_organizer is not true or actor='' or mail='') then raise exception 'Organizer access required' using errcode='42501'; end if;
  -- All configuration/phase writes are serialized; independent votes/ballots use compatible shared locks.
  if p_action like 'organizer.%' and p_action<>'organizer.dashboard' then
    select * into strict s from qoq_private.settings where singleton for update;
  else
    select * into strict s from qoq_private.settings where singleton for share;
  end if;
  case p_action
  when 'public.announcements' then return jsonb_build_object('announcements',qoq_private.news(false));
  when 'public.voting' then return jsonb_build_object('voting',s.voting,'candidates',case when s.voting='open' then qoq_private.candidate_list() else '[]'::jsonb end);
  when 'public.photo' then
    if s.voting='open' and exists(select 1 from qoq_private.candidates where photo_key=(p_data->>'photoKey')::uuid) then return jsonb_build_object('ok',true); end if;
    raise exception 'Photo unavailable' using errcode='42501';
  when 'voter.cast' then
    if s.voting<>'open' then raise exception 'Voting is not open' using errcode='55000'; end if;
    if actor='' or mail!~'^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then raise exception 'Sign-in required' using errcode='42501'; end if;
    candidate:=(p_data->>'candidateId')::uuid;
    if not exists(select 1 from qoq_private.candidates where id=candidate) then raise exception 'Choose an eligible candidate' using errcode='22023'; end if;
    insert into qoq_private.votes(actor_hash,email_hash,candidate_id) values(
     encode(sha256(convert_to(s.voter_salt::text||':uid:'||actor,'utf8')),'hex'),
     encode(sha256(convert_to(s.voter_salt::text||':email:'||mail,'utf8')),'hex'),candidate
    ) on conflict do nothing;
    if not found then raise exception 'A vote has already been recorded for this account' using errcode='23505'; end if;
    return jsonb_build_object('ok',true);
  when 'organizer.dashboard' then return qoq_private.dashboard();
  else null;
  end case;
  if p_action like 'judge.%' then
    if actor='' or mail='' then raise exception 'Judge sign-in required' using errcode='42501'; end if;
    select * into j from qoq_private.judges where email=mail and (qoq_private.judges.actor is null or qoq_private.judges.actor=p_actor) for update;
    if not found then raise exception 'Judge assignment required' using errcode='42501'; end if;
    if s.phase='setup' then
      if p_action='judge.ballot' then return jsonb_build_object('phase',s.phase,'locked',false,'candidates','[]'::jsonb,'criteria','[]'::jsonb,'scores','[]'::jsonb); end if;
      raise exception 'Scoring is not open' using errcode='55000';
    end if;
    if j.actor is null then update qoq_private.judges set actor=p_actor where id=j.id; end if;
    if p_action='judge.ballot' then
      return jsonb_build_object('phase',s.phase,'locked',j.locked_at is not null,'candidates',qoq_private.candidate_list(),
        'criteria',qoq_private.criterion_list(),'scores',qoq_private.score_list(j.id));
    end if;
    if s.phase<>'scoring' or j.locked_at is not null then raise exception 'This ballot is locked' using errcode='55000'; end if;
    if p_action='judge.save' then
      if jsonb_typeof(p_data->'scores') is distinct from 'array' then raise exception 'A score list is required' using errcode='22023'; end if;
      score_count:=jsonb_array_length(p_data->'scores');
      if score_count not between 1 and 4000 or exists(select 1 from jsonb_array_elements(p_data->'scores') e
        where jsonb_typeof(e->'score') is distinct from 'number' or e->>'candidateId' is null or e->>'criterionId' is null) then
        raise exception 'Invalid score list' using errcode='22023';
      end if;
      if exists(select 1 from jsonb_to_recordset(p_data->'scores') as b("candidateId" uuid,"criterionId" uuid,score numeric)
        left join qoq_private.candidates c on c.id=b."candidateId" left join qoq_private.criteria k on k.id=b."criterionId"
        where c.id is null or k.id is null or b.score not between 0 and 100 or scale(b.score)>2) then
        raise exception 'Choose a valid candidate, criterion and a score of 0–100 with up to two decimals' using errcode='22023';
      end if;
      if (select count(distinct (b."candidateId",b."criterionId")) from jsonb_to_recordset(p_data->'scores') as b("candidateId" uuid,"criterionId" uuid))<>score_count then
        raise exception 'A score cell occurs twice' using errcode='22023'; end if;
      insert into qoq_private.scores(judge_id,candidate_id,criterion_id,score)
        select j.id,b."candidateId",b."criterionId",b.score from jsonb_to_recordset(p_data->'scores') as b("candidateId" uuid,"criterionId" uuid,score numeric)
        on conflict(judge_id,candidate_id,criterion_id) do update set score=excluded.score;
    elsif p_action='judge.lock' then
      update qoq_private.judges set locked_at=clock_timestamp() where id=j.id;
    else raise exception 'Unknown action' using errcode='22023';
    end if;
    insert into qoq_private.audit(actor,action,target) values(p_actor,p_action,j.id);
    return jsonb_build_object('ok',true);
  end if;
  if p_action not like 'organizer.%' then raise exception 'Unknown action' using errcode='22023'; end if;
  item:=(p_data->>'id')::uuid;
  n:=trim(p_data->>'name');
  case p_action
    when 'organizer.candidate' then
      if n is null or length(n) not between 1 and 120 then raise exception 'Enter a candidate name' using errcode='22023'; end if;
      photo:=nullif(p_data->>'photoKey','')::uuid;
      if item is null then insert into qoq_private.candidates(name,photo_key) values(n,photo) returning id into item;
      else update qoq_private.candidates set name=n,photo_key=case when p_data?'photoKey' then photo else photo_key end where id=item;
        if not found then raise exception 'Unknown candidate' using errcode='22023'; end if;
      end if;
    when 'organizer.judge' then
      msg:=lower(trim(p_data->>'email'));
      if n is null or length(n) not between 1 and 120 or msg is null or length(msg)>254 or msg!~'^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then raise exception 'Enter judge name and email' using errcode='22023'; end if;
      if item is null then insert into qoq_private.judges(name,email) values(n,msg) returning id into item;
      else update qoq_private.judges set name=n,email=msg where id=item;
        if not found then raise exception 'Unknown judge' using errcode='22023'; end if;
      end if;
    when 'organizer.criterion' then
      if n is null or length(n) not between 1 and 100 or jsonb_typeof(p_data->'weight') is distinct from 'number' or
         (p_data->>'weight')::numeric not between 0.01 and 100 or scale((p_data->>'weight')::numeric)>2 then raise exception 'Enter a criterion name and valid percentage' using errcode='22023'; end if;
      if item is null then insert into qoq_private.criteria(name,weight) values(n,(p_data->>'weight')::numeric) returning id into item;
      else update qoq_private.criteria set name=n,weight=(p_data->>'weight')::numeric where id=item;
        if not found then raise exception 'Unknown criterion' using errcode='22023'; end if;
      end if;
    when 'organizer.remove' then
      case p_data->>'kind'
        when 'candidate' then delete from qoq_private.candidates where id=item;
        when 'judge' then delete from qoq_private.judges where id=item;
        when 'criterion' then delete from qoq_private.criteria where id=item;
        else raise exception 'Unknown item type' using errcode='22023';
      end case;
      get diagnostics affected=row_count;
      if affected<>1 then raise exception 'Item not found' using errcode='22023'; end if;
    when 'organizer.announcement' then
      n:=trim(p_data->>'title');msg:=trim(p_data->>'body');
      if n is null or length(n) not between 1 and 140 or msg is null or length(msg) not between 1 and 2400 or jsonb_typeof(p_data->'published') is distinct from 'boolean' then raise exception 'Enter a title, body and publication state' using errcode='22023'; end if;
      if item is null then insert into qoq_private.announcements(title,body,published) values(n,msg,(p_data->>'published')::boolean) returning id into item;
      else update qoq_private.announcements set title=n,body=msg,published=(p_data->>'published')::boolean,updated_at=now() where id=item;
        if not found then raise exception 'Unknown announcement' using errcode='22023'; end if;
      end if;
    when 'organizer.openScoring' then
      if s.phase<>'setup' then raise exception 'Scoring already started' using errcode='55000'; end if;
      update qoq_private.settings set phase='scoring' where singleton;
    when 'organizer.lockTabulation' then
      if s.phase<>'scoring' then raise exception 'No open tabulation' using errcode='55000'; end if;
      update qoq_private.settings set phase='locked' where singleton;
    when 'organizer.openVoting' then
      if s.voting<>'closed' then raise exception 'Voting has already opened for this edition' using errcode='55000'; end if;
      update qoq_private.settings set voting='open' where singleton;
    when 'organizer.closeVoting' then
      if s.voting<>'open' then raise exception 'Voting is not open' using errcode='55000'; end if;
      update qoq_private.settings set voting='ended' where singleton;
    else raise exception 'Unknown action' using errcode='22023';
  end case;
  insert into qoq_private.audit(actor,action,target) values(p_actor,p_action,item);
  return jsonb_strip_nulls(jsonb_build_object('ok',true,'id',item));
end $$;

do $$ declare t text; begin
  foreach t in array array['settings','candidates','judges','criteria','scores','announcements','votes','audit'] loop
    execute format('alter table qoq_private.%I enable row level security',t);
  end loop;
end $$;
revoke all on all tables in schema qoq_private from public,anon,authenticated;
revoke all on all sequences in schema qoq_private from public,anon,authenticated;
revoke all on all functions in schema qoq_private from public,anon,authenticated;
revoke all on function public.qoq_operations(text,text,text,boolean,text,jsonb) from public,anon,authenticated;
grant execute on function public.qoq_operations(text,text,text,boolean,text,jsonb) to anon;
