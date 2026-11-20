-- 21 November 2026. Additive.
--  1. Sign-in without a ChatGPT account: organizer password and per-judge access codes.
--     Only salted PBKDF2 hashes made by the Worker are stored; plain passwords and codes never reach the database.
--  2. The People's Choice Award: decided by purchased voting points, separate from the Queen of Quiapo title,
--     published by the organizer from the final points snapshot.

-- 1 -------------------------------------------------------------------------
create table qoq_private.credentials (
  email text not null check (length(email)<=254 and email=lower(trim(email)) and email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'),
  role text not null check (role in ('organizer','judge')),
  secret_hash text not null check (secret_hash ~ '^pbkdf2-sha256[$][0-9]{5,7}[$][A-Za-z0-9_-]{16,64}[$][A-Za-z0-9_-]{40,64}$'),
  version int not null default 1 check (version>0),
  failed int not null default 0 check (failed>=0),
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_login_at timestamptz,
  primary key (email, role)
);
alter table qoq_private.credentials enable row level security;
revoke all on qoq_private.credentials from public,anon,authenticated;

create function public.qoq_access(p_secret text,p_actor text,p_email text,p_organizer boolean,p_action text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare
  c qoq_private.credentials%rowtype; j qoq_private.judges%rowtype;
  mail text:=lower(trim(coalesce(p_data->>'email',''))); kind text:=p_data->>'role'; me text:=lower(trim(coalesce(p_email,'')));
begin
  if not public.qoq_media_authorized(p_secret) then raise exception 'Access denied' using errcode='42501'; end if;
  if jsonb_typeof(p_data) is distinct from 'object' or pg_column_size(p_data)>4000 then raise exception 'Invalid request data' using errcode='22023'; end if;
  case p_action
  -- Worker-only steps of a sign-in. None of them is reachable from a browser.
  when 'credential' then
    if kind not in ('organizer','judge') then raise exception 'Invalid role' using errcode='22023'; end if;
    if kind='judge' and not exists(select 1 from qoq_private.judges where email=mail) then return '{}'; end if;
    select * into c from qoq_private.credentials where email=mail and role=kind;
    if not found then return '{}'; end if;
    return jsonb_build_object('hash',c.secret_hash,'version',c.version,'locked',coalesce(c.locked_until>clock_timestamp(),false));
  when 'attempt' then
    select * into c from qoq_private.credentials where email=mail and role=kind for update;
    if not found then return '{}'; end if;
    if c.locked_until>clock_timestamp() then return jsonb_build_object('locked',true); end if;
    if (p_data->>'ok')::boolean then
      update qoq_private.credentials set failed=0,locked_until=null,last_login_at=clock_timestamp() where email=mail and role=kind;
      perform qoq_private.log(kind||':'||mail,'access.signin',null,jsonb_build_object('role',kind));
      return jsonb_build_object('version',c.version);
    end if;
    -- Ten wrong attempts lock the account for fifteen minutes.
    if c.failed+1>=10 then
      update qoq_private.credentials set failed=0,locked_until=clock_timestamp()+interval '15 minutes' where email=mail and role=kind;
      perform qoq_private.log(kind||':'||mail,'access.locked',null,jsonb_build_object('role',kind));
      return jsonb_build_object('locked',true);
    end if;
    update qoq_private.credentials set failed=failed+1 where email=mail and role=kind;
    return jsonb_build_object('locked',false);
  when 'verify' then
    -- A session is valid only while its credential exists at the same version, and a judge is still assigned.
    return jsonb_build_object('valid',exists(select 1 from qoq_private.credentials cr where cr.email=mail and cr.role=kind and cr.version=(p_data->>'version')::int
      and (kind<>'judge' or exists(select 1 from qoq_private.judges where email=mail))));
  else null;
  end case;

  if p_action not like 'organizer.%' then raise exception 'Unknown action' using errcode='22023'; end if;
  if p_organizer is not true or trim(coalesce(p_actor,''))='' or me='' then raise exception 'Organizer access required' using errcode='42501'; end if;
  case p_action
  when 'organizer.accessStatus' then
    return jsonb_build_object(
      'organizer',(select jsonb_build_object('hasPassword',true,'updatedAt',updated_at,'lastLoginAt',last_login_at) from qoq_private.credentials where email=me and role='organizer'),
      'judges',(select coalesce(jsonb_agg(jsonb_build_object('judgeId',j2.id,'name',j2.name,'email',j2.email,'hasCode',c2.email is not null,'issuedAt',c2.updated_at,
          'lastLoginAt',c2.last_login_at,'locked',coalesce(c2.locked_until>clock_timestamp(),false)) order by j2.name,j2.id),'[]')
        from qoq_private.judges j2 left join qoq_private.credentials c2 on c2.email=j2.email and c2.role='judge'));
  when 'organizer.setJudgeCode' then
    select * into j from qoq_private.judges where id=(p_data->>'judgeId')::uuid;
    if not found then raise exception 'Unknown judge' using errcode='22023'; end if;
    if j.locked_at is not null then raise exception 'This judge has already locked their ballot' using errcode='55000'; end if;
    insert into qoq_private.credentials(email,role,secret_hash) values(j.email,'judge',p_data->>'hash')
      on conflict(email,role) do update set secret_hash=excluded.secret_hash,version=qoq_private.credentials.version+1,failed=0,locked_until=null,updated_at=clock_timestamp();
    perform qoq_private.log(p_actor,p_action,j.id,jsonb_build_object('judge',j.email));
    return jsonb_build_object('ok',true);
  when 'organizer.revokeJudgeCode' then
    select * into j from qoq_private.judges where id=(p_data->>'judgeId')::uuid;
    if not found then raise exception 'Unknown judge' using errcode='22023'; end if;
    delete from qoq_private.credentials where email=j.email and role='judge';
    perform qoq_private.log(p_actor,p_action,j.id,jsonb_build_object('judge',j.email));
    return jsonb_build_object('ok',true);
  when 'organizer.setPassword' then
    -- The Worker has already confirmed the signed-in organizer and, for a password session, the current password.
    insert into qoq_private.credentials(email,role,secret_hash) values(me,'organizer',p_data->>'hash')
      on conflict(email,role) do update set secret_hash=excluded.secret_hash,version=qoq_private.credentials.version+1,failed=0,locked_until=null,updated_at=clock_timestamp();
    perform qoq_private.log(p_actor,p_action,null,null);
    return jsonb_build_object('ok',true);
  else raise exception 'Unknown action' using errcode='22023';
  end case;
exception when check_violation then raise exception 'The credential could not be stored' using errcode='22023';
end $$;

-- 2 -------------------------------------------------------------------------
alter table qoq_private.settings
  add column peoples_choice_published_at timestamptz,
  add column peoples_choice_show_points boolean not null default false;

create function public.qoq_award(p_secret text,p_actor text,p_email text,p_organizer boolean,p_action text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare s qoq_private.settings%rowtype; v qoq_private.voting_snapshots%rowtype; winners jsonb;
begin
  if not public.qoq_media_authorized(p_secret) then raise exception 'Access denied' using errcode='42501'; end if;
  if jsonb_typeof(p_data) is distinct from 'object' or pg_column_size(p_data)>2000 then raise exception 'Invalid request data' using errcode='22023'; end if;
  if p_action like 'organizer.%' then
    if p_organizer is not true or trim(coalesce(p_actor,''))='' or trim(coalesce(p_email,''))='' then raise exception 'Organizer access required' using errcode='42501'; end if;
    select * into strict s from qoq_private.settings where singleton for update;
  else
    select * into strict s from qoq_private.settings where singleton;
  end if;
  select * into v from qoq_private.voting_snapshots where edition_id=s.edition_id;
  -- The award goes to the highest valid point total in the final, immutable snapshot. Equal totals are a tie and are shown as one.
  winners:=(select coalesce(jsonb_agg(jsonb_build_object('number',e->'number','name',e->'name','points',(e->>'points')::bigint) order by e->>'number'),'[]')
    from jsonb_array_elements(v.report->'totals') e where (e->>'rank')::int=1 and (e->>'points')::bigint>0);
  case p_action
  when 'public.peoplesChoice' then
    if s.peoples_choice_published_at is null then return jsonb_build_object('published',false); end if;
    return jsonb_build_object('published',true,'publishedAt',s.peoples_choice_published_at,'finalizedAt',v.finalized_at,'tied',jsonb_array_length(winners)>1,
      'winners',case when s.peoples_choice_show_points then winners else (select coalesce(jsonb_agg(w-'points'),'[]') from jsonb_array_elements(winners) w) end);
  when 'organizer.awardStatus' then
    return jsonb_build_object('publishedAt',s.peoples_choice_published_at,'showPoints',s.peoples_choice_show_points,'ready',v.edition_id is not null,'winners',winners);
  when 'organizer.publishPeoplesChoice' then
    if v.edition_id is null or s.voting<>'finalized' then raise exception 'Finalize the voting points before announcing the People’s Choice Award' using errcode='55000'; end if;
    if jsonb_array_length(winners)=0 then raise exception 'No candidate received points' using errcode='55000'; end if;
    if jsonb_array_length(winners)>1 and coalesce((p_data->>'acknowledgeTie')::boolean,false) is not true then
      raise exception 'The highest point total is tied. Apply the published tie rule, or announce the shared award explicitly.' using errcode='55000'; end if;
    update qoq_private.settings set peoples_choice_published_at=clock_timestamp(),peoples_choice_show_points=coalesce((p_data->>'showPoints')::boolean,false) where singleton;
    perform qoq_private.log(p_actor,p_action,null,jsonb_build_object('showPoints',coalesce((p_data->>'showPoints')::boolean,false),'digest',v.digest));
    return jsonb_build_object('ok',true);
  when 'organizer.unpublishPeoplesChoice' then
    if s.peoples_choice_published_at is null then raise exception 'The award is not published' using errcode='55000'; end if;
    update qoq_private.settings set peoples_choice_published_at=null where singleton;
    perform qoq_private.log(p_actor,p_action,null,null);
    return jsonb_build_object('ok',true);
  else raise exception 'Unknown action' using errcode='22023';
  end case;
end $$;

revoke all on all functions in schema qoq_private from public,anon,authenticated;
revoke all on function public.qoq_access(text,text,text,boolean,text,jsonb) from public,anon,authenticated;
grant execute on function public.qoq_access(text,text,text,boolean,text,jsonb) to anon;
revoke all on function public.qoq_award(text,text,text,boolean,text,jsonb) from public,anon,authenticated;
grant execute on function public.qoq_award(text,text,text,boolean,text,jsonb) to anon;
