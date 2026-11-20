-- 22 November 2026. Additive: the public can read the application window and confirmed screening details,
-- so applicants learn before filling the form whether it is open, and the receipt shows the venue once recorded.
create or replace function public.qoq_edition(p_secret text,p_actor text,p_email text,p_organizer boolean,p_action text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare e qoq_private.editions%rowtype; field text; changes jsonb:='{}';
begin
  if not public.qoq_media_authorized(p_secret) then raise exception 'Access denied' using errcode='42501'; end if;
  if p_action='public.applications' then
    -- What an applicant needs before starting: whether the form is open, the window, and the confirmed screening details.
    select * into strict e from qoq_private.editions where is_current;
    return jsonb_build_object('open',(e.applications_open_at is null or clock_timestamp()>=e.applications_open_at) and (e.applications_close_at is null or clock_timestamp()<e.applications_close_at),
      'opensAt',e.applications_open_at,'closesAt',e.applications_close_at,'edition',e.name,
      'screeningStartsAt',e.screening_starts_at,'screeningEndsAt',e.screening_ends_at,'screeningVenue',e.screening_venue);
  end if;
  if p_action is distinct from 'organizer.edition' then raise exception 'Unknown action' using errcode='22023'; end if;
  if p_organizer is not true or trim(coalesce(p_actor,''))='' or trim(coalesce(p_email,''))='' then raise exception 'Organizer access required' using errcode='42501'; end if;
  if jsonb_typeof(p_data) is distinct from 'object' or pg_column_size(p_data)>4000 then raise exception 'Invalid request data' using errcode='22023'; end if;
  select * into strict e from qoq_private.editions where is_current for update;
  -- Only details that the organizers confirm later are editable here. Dates of the two events are fixed in the edition record.
  foreach field in array array['screeningVenue','coronationVenue','coronationStartsAt','applicationsOpenAt','applicationsCloseAt'] loop
    if p_data ? field then changes:=changes||jsonb_build_object(field,p_data->field); end if;
  end loop;
  if changes='{}' then raise exception 'Nothing to change' using errcode='22023'; end if;
  begin
    update qoq_private.editions set
      screening_venue=case when changes?'screeningVenue' then nullif(trim(changes->>'screeningVenue'),'') else screening_venue end,
      coronation_venue=case when changes?'coronationVenue' then nullif(trim(changes->>'coronationVenue'),'') else coronation_venue end,
      coronation_starts_at=case when changes?'coronationStartsAt' then (nullif(changes->>'coronationStartsAt',''))::timestamptz else coronation_starts_at end,
      applications_open_at=case when changes?'applicationsOpenAt' then (nullif(changes->>'applicationsOpenAt',''))::timestamptz else applications_open_at end,
      applications_close_at=case when changes?'applicationsCloseAt' then (nullif(changes->>'applicationsCloseAt',''))::timestamptz else applications_close_at end
    where id=e.id returning * into e;
  exception when invalid_datetime_format or datetime_field_overflow then raise exception 'Enter a valid date and time' using errcode='22023';
    when check_violation then raise exception 'Check the venue length and that applications close after they open' using errcode='22023';
  end;
  if e.coronation_starts_at is not null and (e.coronation_starts_at at time zone 'Asia/Manila')::date<>e.coronation_date then
    raise exception 'The coronation time must fall on the coronation date' using errcode='22023'; end if;
  perform qoq_private.log(p_actor,p_action,null,changes);
  return jsonb_build_object('ok',true);
end $$;

revoke all on function public.qoq_edition(text,text,text,boolean,text,jsonb) from public,anon,authenticated;
grant execute on function public.qoq_edition(text,text,text,boolean,text,jsonb) to anon;
