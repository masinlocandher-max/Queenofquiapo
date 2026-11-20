-- Judging: ranked tabulation with tie flags, an immutable final snapshot, certification and controlled publication.
-- The aggregation policy is unchanged from the first release:
--   candidate score = sum over locked ballots of (score x criterion weight / 100), divided by the number of locked ballots.
-- Ranking compares the exact weighted sums, so rounding to two decimals for display can never create or hide a tie.

create or replace function qoq_private.candidate_list() returns jsonb language sql stable set search_path=pg_catalog,pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'number',number,'name',name,'photoKey',photo_key) order by number nulls last,name,id),'[]')
  from qoq_private.candidates where status='active'
$$;
create or replace function qoq_private.criterion_list() returns jsonb language sql stable set search_path=pg_catalog,pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'weight',weight,'description',description,'displayOrder',display_order) order by display_order,name,id),'[]') from qoq_private.criteria
$$;

create function qoq_private.tabulate() returns jsonb language sql stable set search_path=pg_catalog,pg_temp as $$
  with locked as (select id from qoq_private.judges where locked_at is not null),
  n as (select count(*)::numeric c from locked),
  cell as (
    select b.candidate_id,b.criterion_id,sum(b.score) total
    from qoq_private.scores b join locked j on j.id=b.judge_id
    join qoq_private.candidates c on c.id=b.candidate_id and c.status='active'
    group by b.candidate_id,b.criterion_id),
  per as (select cell.candidate_id,sum(cell.total*k.weight) weighted_sum from cell join qoq_private.criteria k on k.id=cell.criterion_id group by cell.candidate_id),
  ranked as (select per.*,rank() over (order by weighted_sum desc) rnk,count(*) over (partition by weighted_sum) ties from per)
  select coalesce(jsonb_agg(jsonb_build_object('candidateId',c.id,'number',c.number,'name',c.name,
      'score',round(r.weighted_sum/100/n.c,2),'exact',round(r.weighted_sum/100/n.c,6),'rank',r.rnk,'tied',r.ties>1,
      'criteria',(select jsonb_agg(jsonb_build_object('criterionId',k.id,'name',k.name,'weight',k.weight,
          'average',round(cell.total/n.c,4),'weighted',round(cell.total*k.weight/100/n.c,4)) order by k.display_order,k.name,k.id)
        from cell join qoq_private.criteria k on k.id=cell.criterion_id where cell.candidate_id=c.id))
    order by r.rnk,c.number nulls last,c.name,c.id),'[]')
  from ranked r join qoq_private.candidates c on c.id=r.candidate_id, n
$$;

create table qoq_private.tabulation_snapshots (
  edition_id text primary key references qoq_private.editions(id),
  finalized_at timestamptz not null default now(),
  finalized_by text not null,
  report jsonb not null,
  digest text not null check (digest ~ '^[a-f0-9]{64}$')
);
alter table qoq_private.tabulation_snapshots enable row level security;
create trigger qoq_tabulation_snapshot_immutable before update or delete on qoq_private.tabulation_snapshots for each row execute function qoq_private.guard_append_only();

drop function qoq_private.dashboard();
create function qoq_private.dashboard() returns jsonb language sql stable set search_path=pg_catalog,pg_temp as $$
  select jsonb_build_object(
    'edition',(select jsonb_build_object('id',id,'name',name,'theme',theme,'timezone',timezone,'screeningStartsAt',screening_starts_at,'screeningEndsAt',screening_ends_at,
        'screeningVenue',screening_venue,'coronationDate',coronation_date,'coronationStartsAt',coronation_starts_at,'coronationVenue',coronation_venue,
        'applicationsOpenAt',applications_open_at,'applicationsCloseAt',applications_close_at) from qoq_private.editions where id=r.edition_id),
    'round',jsonb_build_object('phase',r.phase,'voting',r.voting,'rosterLockedAt',r.roster_locked_at,'scoringOpenedAt',r.scoring_opened_at,
      'paymentsEnabled',r.payments_enabled,'providerConfigured',r.payment_provider is not null),
    'candidates',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'number',number,'name',name,'photoKey',photo_key,'published',published,'status',status,
        'bio',bio,'consentRef',consent_ref,'fromApplication',application_ref is not null,'updatedAt',updated_at) order by number nulls last,name,id),'[]') from qoq_private.candidates),
    'criteria',qoq_private.criterion_list(),'announcements',qoq_private.news(true),
    'legacyVotes',(select count(*) from qoq_private.votes),
    'applications',(select jsonb_build_object('total',count(*),'pending',count(*) filter (where status in ('submitted','under_review','correction_requested')),
        'approved',count(*) filter (where status='approved')) from qoq_private.applications),
    'judges',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'email',email,'locked',locked_at is not null,'lockedAt',locked_at,'linked',actor is not null,'lastSeenAt',last_seen_at,
        'scored',(select count(*) from qoq_private.scores x where x.judge_id=judges.id)) order by name,id),'[]') from qoq_private.judges),
    'tabulation',jsonb_build_object(
       'pending',(select count(*) from qoq_private.judges where locked_at is null),
       'total',(select count(*) from qoq_private.judges),'final',r.phase='locked','finalizedAt',r.finalized_at,
       'cells',(select count(*) from qoq_private.candidates where status='active')*(select count(*) from qoq_private.criteria),
       'ballots',(select coalesce(jsonb_agg(jsonb_build_object('judgeId',j.id,'judgeName',j.name,'lockedAt',j.locked_at,'scores',qoq_private.score_list(j.id)) order by j.name,j.id),'[]') from qoq_private.judges j where j.locked_at is not null),
       'results',coalesce(t.report->'results',qoq_private.tabulate()),
       'digest',t.digest,'finalizedBy',t.finalized_by,
       -- Recomputed from the locked ballots on every read and compared with the stored snapshot.
       'verified',case when t.digest is null then null else t.report->'results'=qoq_private.tabulate() end,
       'certifiedAt',r.results_certified_at,'certifiedBy',r.results_certified_by,'publishedAt',r.results_published_at,'scope',r.results_scope))
  from qoq_private.settings r left join qoq_private.tabulation_snapshots t on t.edition_id=r.edition_id where r.singleton
$$;

create or replace function public.qoq_operations(p_secret text,p_actor text,p_email text,p_organizer boolean,p_action text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare
  s qoq_private.settings%rowtype; j qoq_private.judges%rowtype; item uuid;
  n text; mail text:=lower(trim(coalesce(p_email,''))); actor text:=trim(coalesce(p_actor,''));
  msg text; score_count int; affected int; photo uuid; num int; pub boolean; report jsonb; results jsonb; top int;
begin
  if p_secret is null or length(p_secret) not between 32 and 512 then raise exception 'Access denied' using errcode='42501'; end if;
  if not exists(select 1 from qoq_private.settings where singleton and secret_hash=encode(sha256(convert_to(p_secret,'utf8')),'hex')) then
    raise exception 'Access denied' using errcode='42501';
  end if;
  if p_action is null or jsonb_typeof(coalesce(p_data,'{}'))<>'object' or octet_length(coalesce(p_data,'{}')::text)>350000 then raise exception 'Invalid request data' using errcode='22023'; end if;
  p_data:=coalesce(p_data,'{}');
  if p_action like 'organizer.%' and (p_organizer is not true or actor='' or mail='') then raise exception 'Organizer access required' using errcode='42501'; end if;
  if p_action like 'organizer.%' and p_action not in ('organizer.dashboard','organizer.audit') then
    select * into strict s from qoq_private.settings where singleton for update;
  else
    select * into strict s from qoq_private.settings where singleton for share;
  end if;
  case p_action
  when 'public.announcements' then return jsonb_build_object('announcements',qoq_private.news(false));
  when 'public.event' then
    return (select jsonb_build_object('id',id,'name',name,'theme',theme,'timezone',timezone,'screeningStartsAt',screening_starts_at,'screeningEndsAt',screening_ends_at,
      'screeningVenue',screening_venue,'coronationDate',coronation_date,'coronationStartsAt',coronation_starts_at,'coronationVenue',coronation_venue,
      'applicationsOpen',(applications_open_at is null or clock_timestamp()>=applications_open_at) and (applications_close_at is null or clock_timestamp()<applications_close_at))
      from qoq_private.editions where id=s.edition_id);
  when 'public.photo' then
    if exists(select 1 from qoq_private.candidates where photo_key=(p_data->>'photoKey')::uuid and published and status='active') then return jsonb_build_object('ok',true); end if;
    raise exception 'Photo unavailable' using errcode='42501';
  when 'public.results' then
    -- Nothing is returned until an organizer has certified and then published the locked tabulation.
    if s.results_published_at is null then return jsonb_build_object('published',false); end if;
    top:=(s.results_scope->>'top')::int;
    return jsonb_build_object('published',true,'publishedAt',s.results_published_at,'certifiedAt',s.results_certified_at,
      'edition',(select name from qoq_private.editions where id=s.edition_id),
      'placements',(select coalesce(jsonb_agg(jsonb_build_object('rank',e->'rank','tied',e->'tied','number',e->'number','name',e->'name')
          || case when (s.results_scope->>'showScores')::boolean then jsonb_build_object('score',e->'score') else '{}'::jsonb end order by ord),'[]')
        from qoq_private.tabulation_snapshots t, jsonb_array_elements(t.report->'results') with ordinality x(e,ord)
        where t.edition_id=s.edition_id and (top is null or (e->>'rank')::int<=top)));
  when 'organizer.dashboard' then return qoq_private.dashboard();
  when 'organizer.audit' then
    return jsonb_build_object('entries',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'at',occurred_at,'actor',a.actor,'action',action,'target',target,'details',details) order by id desc),'[]')
      from (select * from qoq_private.audit where id<coalesce((p_data->>'before')::bigint,9223372036854775807) order by id desc limit 100) a));
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
    if j.locked_at is null then update qoq_private.judges set actor=coalesce(judges.actor,p_actor),last_seen_at=clock_timestamp() where id=j.id; end if;
    if p_action='judge.ballot' then
      return jsonb_build_object('phase',s.phase,'locked',j.locked_at is not null,'lockedAt',j.locked_at,'judgeName',j.name,'candidates',qoq_private.candidate_list(),
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
        left join qoq_private.candidates c on c.id=b."candidateId" and c.status='active' left join qoq_private.criteria k on k.id=b."criterionId"
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
    perform qoq_private.log(p_actor,p_action,j.id,case when p_action='judge.save' then jsonb_build_object('cells',score_count) end);
    return jsonb_build_object('ok',true);
  end if;

  if p_action not like 'organizer.%' then raise exception 'Unknown action' using errcode='22023'; end if;
  item:=(p_data->>'id')::uuid;
  n:=trim(p_data->>'name');
  case p_action
    when 'organizer.candidate' then
      if n is null or length(n) not between 1 and 120 then raise exception 'Enter a candidate name' using errcode='22023'; end if;
      photo:=nullif(p_data->>'photoKey','')::uuid;
      num:=nullif(p_data->>'number','')::int;
      pub:=coalesce((p_data->>'published')::boolean,false);
      msg:=nullif(trim(coalesce(p_data->>'consentRef','')),'');
      if num is not null and num not between 1 and 999 then raise exception 'Candidate numbers run from 1 to 999' using errcode='22023'; end if;
      if length(coalesce(p_data->>'bio',''))>600 or length(coalesce(msg,''))>200 then raise exception 'Shorten the biography or clearance reference' using errcode='22023'; end if;
      if coalesce(p_data->>'status','active') not in ('active','withdrawn') then raise exception 'Unknown participation status' using errcode='22023'; end if;
      if pub and (msg is null or num is null or coalesce(p_data->>'status','active')<>'active') then
        raise exception 'Publishing needs a candidate number and a recorded publicity clearance' using errcode='22023'; end if;
      if num is not null and exists(select 1 from qoq_private.candidates where number=num and edition_id=s.edition_id and id is distinct from item) then
        raise exception 'That candidate number is already assigned' using errcode='23505'; end if;
      if item is null then
        insert into qoq_private.candidates(name,photo_key,number,published,status,bio,consent_ref)
          values(n,photo,num,pub,coalesce(p_data->>'status','active'),nullif(trim(coalesce(p_data->>'bio','')),''),msg) returning id into item;
      else
        update qoq_private.candidates set name=n,photo_key=case when p_data?'photoKey' then photo else photo_key end,number=num,published=pub,
          status=coalesce(p_data->>'status','active'),bio=nullif(trim(coalesce(p_data->>'bio','')),''),consent_ref=msg where id=item;
        if not found then raise exception 'Unknown candidate' using errcode='22023'; end if;
      end if;
      perform qoq_private.log(p_actor,p_action,item,jsonb_build_object('name',n,'number',num,'published',pub,'status',coalesce(p_data->>'status','active')));
      return jsonb_build_object('ok',true,'id',item);
    when 'organizer.lockRoster' then
      if s.roster_locked_at is not null then raise exception 'The roster is already locked' using errcode='55000'; end if;
      if not exists(select 1 from qoq_private.candidates where status='active') then raise exception 'Add official candidates before locking the roster' using errcode='55000'; end if;
      update qoq_private.settings set roster_locked_at=clock_timestamp() where singleton;
    when 'organizer.unlockRoster' then
      if s.roster_locked_at is null then raise exception 'The roster is not locked' using errcode='55000'; end if;
      update qoq_private.settings set roster_locked_at=null where singleton;
    when 'organizer.judge' then
      msg:=lower(trim(p_data->>'email'));
      if n is null or length(n) not between 1 and 120 or msg is null or length(msg)>254 or msg!~'^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then raise exception 'Enter judge name and email' using errcode='22023'; end if;
      if exists(select 1 from qoq_private.judges where email=msg and id is distinct from item) then raise exception 'That email is already assigned to a judge' using errcode='23505'; end if;
      if item is null then insert into qoq_private.judges(name,email) values(n,msg) returning id into item;
      else update qoq_private.judges set name=n,email=msg where id=item;
        if not found then raise exception 'Unknown judge' using errcode='22023'; end if;
      end if;
    when 'organizer.criterion' then
      if n is null or length(n) not between 1 and 100 or jsonb_typeof(p_data->'weight') is distinct from 'number' or
         (p_data->>'weight')::numeric not between 0.01 and 100 or scale((p_data->>'weight')::numeric)>2 or length(coalesce(p_data->>'description',''))>400 then
        raise exception 'Enter a criterion name and valid percentage' using errcode='22023'; end if;
      if exists(select 1 from qoq_private.criteria where lower(trim(name))=lower(n) and id is distinct from item) then raise exception 'A criterion with that name already exists' using errcode='23505'; end if;
      if item is null then insert into qoq_private.criteria(name,weight,description,display_order)
        values(n,(p_data->>'weight')::numeric,nullif(trim(coalesce(p_data->>'description','')),''),coalesce((p_data->>'displayOrder')::int,0)) returning id into item;
      else update qoq_private.criteria set name=n,weight=(p_data->>'weight')::numeric,description=nullif(trim(coalesce(p_data->>'description','')),''),
          display_order=coalesce((p_data->>'displayOrder')::int,display_order) where id=item;
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
      perform qoq_private.log(p_actor,p_action,item,jsonb_build_object('kind',p_data->>'kind'));
      return jsonb_build_object('ok',true,'id',item);
    when 'organizer.announcement' then
      n:=trim(p_data->>'title');msg:=trim(p_data->>'body');
      if n is null or length(n) not between 1 and 140 or msg is null or length(msg) not between 1 and 2400 or jsonb_typeof(p_data->'published') is distinct from 'boolean' then raise exception 'Enter a title, body and publication state' using errcode='22023'; end if;
      if item is null then insert into qoq_private.announcements(title,body,published) values(n,msg,(p_data->>'published')::boolean) returning id into item;
      else update qoq_private.announcements set title=n,body=msg,published=(p_data->>'published')::boolean,updated_at=now() where id=item;
        if not found then raise exception 'Unknown announcement' using errcode='22023'; end if;
      end if;
      perform qoq_private.log(p_actor,p_action,item,jsonb_build_object('title',n,'published',p_data->'published'));
      return jsonb_build_object('ok',true,'id',item);
    when 'organizer.openScoring' then
      if s.phase<>'setup' then raise exception 'Scoring already started' using errcode='55000'; end if;
      update qoq_private.settings set phase='scoring',scoring_opened_by=p_actor where singleton;
    when 'organizer.lockTabulation' then
      if s.phase<>'scoring' then raise exception 'No open tabulation' using errcode='55000'; end if;
      update qoq_private.settings set phase='locked' where singleton;
      -- The final record: criteria, judges, every locked score and the computed ranking, with a digest for later verification.
      results:=qoq_private.tabulate();
      report:=jsonb_build_object('edition',s.edition_id,'criteria',qoq_private.criterion_list(),'candidates',qoq_private.candidate_list(),
        'ballots',(select jsonb_agg(jsonb_build_object('judgeId',x.id,'judgeName',x.name,'lockedAt',x.locked_at,'scores',qoq_private.score_list(x.id)) order by x.name,x.id) from qoq_private.judges x),
        'results',results);
      insert into qoq_private.tabulation_snapshots(edition_id,finalized_by,report,digest) values(s.edition_id,p_actor,report,encode(sha256(convert_to(report::text,'utf8')),'hex'));
      perform qoq_private.log(p_actor,p_action,null,jsonb_build_object('digest',encode(sha256(convert_to(report::text,'utf8')),'hex')));
      return jsonb_build_object('ok',true);
    when 'organizer.certifyResults' then
      if s.phase<>'locked' then raise exception 'Lock the final tabulation before certifying' using errcode='55000'; end if;
      if s.results_certified_at is not null then raise exception 'These results are already certified' using errcode='55000'; end if;
      select t.report->'results' into strict results from qoq_private.tabulation_snapshots t where t.edition_id=s.edition_id;
      if results<>qoq_private.tabulate() then raise exception 'The stored results no longer match the locked ballots. Do not certify.' using errcode='55000'; end if;
      -- Ties are never broken by the system. Certifying with a tie requires an explicit acknowledgement.
      if exists(select 1 from jsonb_array_elements(results) e where (e->>'tied')::boolean) and coalesce((p_data->>'acknowledgeTies')::boolean,false) is not true then
        raise exception 'There is a tie. Resolve it under the official rules, or certify the shared placement explicitly.' using errcode='55000'; end if;
      update qoq_private.settings set results_certified_at=clock_timestamp(),results_certified_by=mail where singleton;
    when 'organizer.publishResults' then
      if s.results_certified_at is null then raise exception 'Certify the results before publishing them' using errcode='55000'; end if;
      top:=nullif(p_data->>'top','')::int;
      if top is not null and top not between 1 and 100 then raise exception 'Choose how many placements to publish' using errcode='22023'; end if;
      update qoq_private.settings set results_published_at=clock_timestamp(),
        results_scope=jsonb_build_object('top',top,'showScores',coalesce((p_data->>'showScores')::boolean,false)) where singleton;
    when 'organizer.unpublishResults' then
      if s.results_published_at is null then raise exception 'Results are not published' using errcode='55000'; end if;
      update qoq_private.settings set results_published_at=null where singleton;
    else raise exception 'Unknown action' using errcode='22023';
  end case;
  perform qoq_private.log(p_actor,p_action,item,case when p_action='organizer.publishResults' then p_data-'id' end);
  return jsonb_strip_nulls(jsonb_build_object('ok',true,'id',item));
end $$;

revoke all on all tables in schema qoq_private from public,anon,authenticated;
revoke all on all functions in schema qoq_private from public,anon,authenticated;
revoke all on function public.qoq_operations(text,text,text,boolean,text,jsonb) from public,anon,authenticated;
grant execute on function public.qoq_operations(text,text,text,boolean,text,jsonb) to anon;
