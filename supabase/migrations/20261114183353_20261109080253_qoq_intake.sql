-- Private screening records. The server validates the full profile before inserting an immutable application.
create table qoq_private.applications (
  id bigint generated always as identity primary key,
  reference text not null unique check (reference ~ '^QOQ-[A-F0-9]{16}$'),
  request_key text not null unique check (request_key ~ '^[a-f0-9]{64}$'),
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
  storage_key uuid not null unique,
  submitted_at timestamptz not null default now(),
  profile jsonb not null check (
    jsonb_typeof(profile) = 'object' and pg_column_size(profile) < 16384
    and profile ?& array['legalName','femaleName','email','locality','heightCm','bustIn','waistIn','hipsIn','consentVersion']
    and length(trim(profile->>'legalName')) between 1 and 120 and length(trim(profile->>'femaleName')) between 1 and 120
  ),
  portrait_type text not null check(portrait_type in ('image/jpeg','image/png','image/webp')),
  swimsuit_type text not null check(swimsuit_type in ('image/jpeg','image/png','image/webp'))
);
alter table qoq_private.applications enable row level security;
revoke all on qoq_private.applications from public,anon,authenticated;
revoke all on sequence qoq_private.applications_id_seq from public,anon,authenticated;

create function public.qoq_media_authorized(p_secret text) returns boolean
language sql stable security definer set search_path=pg_catalog,pg_temp
as $$
  select coalesce(length(p_secret) between 32 and 512,false) and exists (
    select from qoq_private.settings where singleton and secret_hash=encode(sha256(convert_to(p_secret,'utf8')),'hex')
  )
$$;
revoke all on function public.qoq_media_authorized(text) from public,anon,authenticated;
grant execute on function public.qoq_media_authorized(text) to service_role;

create function public.qoq_intake(p_secret text,p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp
as $$
declare
  a qoq_private.applications%rowtype;
  cap int;
  last_id bigint;
  page_rows jsonb;
  has_more boolean;
begin
  if not public.qoq_media_authorized(p_secret) then raise exception 'Access denied' using errcode='42501'; end if;
  if jsonb_typeof(p_data) is distinct from 'object' or pg_column_size(p_data)>32768 then
    raise exception 'Invalid payload' using errcode='22023';
  end if;
  case p_action
  when 'find' then
    select * into a from qoq_private.applications where request_key=p_data->>'requestKey';
    if not found then return '{}'::jsonb; end if;
    return jsonb_build_object('reference',a.reference,'fingerprint',a.fingerprint);
  when 'create' then
    insert into qoq_private.applications(reference,request_key,fingerprint,storage_key,profile,portrait_type,swimsuit_type)
    values(p_data->>'reference',p_data->>'requestKey',p_data->>'fingerprint',(p_data->>'storageKey')::uuid,p_data->'profile',p_data->>'portraitType',p_data->>'swimsuitType')
    on conflict(request_key) do nothing returning * into a;
    if not found then return '{}'::jsonb; end if;
    return jsonb_build_object('reference',a.reference);
  when 'withdrawal' then
    select * into a from qoq_private.applications where reference=p_data->>'reference' and request_key=p_data->>'requestKey';
    if not found then return '{}'::jsonb; end if;
    return jsonb_build_object('reference',a.reference,'storageKey',a.storage_key);
  when 'details' then
    select * into a from qoq_private.applications where reference=p_data->>'reference';
    if not found then return '{}'::jsonb; end if;
    return a.profile || jsonb_build_object('reference',a.reference,'submittedAt',a.submitted_at,'storageKey',a.storage_key,'portraitType',a.portrait_type,'swimsuitType',a.swimsuit_type);
  when 'remove' then
    delete from qoq_private.applications where reference=p_data->>'reference' and storage_key=(p_data->>'storageKey')::uuid;
    return jsonb_build_object('ok',true);
  when 'list' then
    cap:=coalesce((p_data->>'limit')::integer,25);
    last_id:=coalesce((p_data->>'cursor')::bigint,9223372036854775807);
    if cap not between 1 and 50 or last_id<1 then raise exception 'Invalid page' using errcode='22023'; end if;
    with batch as (
      select id,jsonb_build_object('reference',reference,'femaleName',profile->>'femaleName','locality',profile->>'locality','submittedAt',submitted_at) as entry
      from qoq_private.applications where id<last_id order by id desc limit cap+1
    ), selected as (select * from batch order by id desc limit cap)
    select coalesce(jsonb_agg(entry order by id desc),'[]'::jsonb),min(id),(select count(*)>cap from batch)
      into page_rows,last_id,has_more from selected;
    return jsonb_build_object('applications',page_rows,'nextCursor',case when has_more then last_id else null end);
  else raise exception 'Unknown action' using errcode='22023';
  end case;
end $$;
revoke all on function public.qoq_intake(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.qoq_intake(text,text,jsonb) to anon,service_role;
