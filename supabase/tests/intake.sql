-- Disposable migrated database only. This test rolls back its synthetic applicant.
begin;
do $$
declare
  secret text:=repeat('test-only-',5); key text:=repeat('a',64); ref text:='QOQ-0123456789ABCDEF';
  storage uuid:=gen_random_uuid(); req jsonb; profile jsonb; r jsonb;
begin
 if exists(select from qoq_private.settings) then raise exception 'Use a clean test database'; end if;
 if has_table_privilege('anon','qoq_private.applications','select') or has_table_privilege('authenticated','qoq_private.applications','insert')
   or has_function_privilege('authenticated','public.qoq_media_authorized(text)','execute') then raise exception 'Unexpected client access to private application records'; end if;
 insert into qoq_private.settings(secret_hash) values(encode(sha256(convert_to(secret,'utf8')),'hex'));
 if public.qoq_media_authorized('invalid') or not public.qoq_media_authorized(secret) then raise exception 'Media authorization failure'; end if;
 begin
   perform public.qoq_intake('invalid','list','{}');raise exception 'Invalid secret accepted';
 exception when insufficient_privilege then null;
 end;
 profile:='{"legalName":"Synthetic Applicant","femaleName":"Synthetic Stage","email":"fixture@example.invalid","locality":"Manila","heightCm":171,"bustIn":34,"waistIn":26,"hipsIn":34,"consentVersion":"screening-v1"}';
 req:=jsonb_build_object('reference',ref,'requestKey',key,'fingerprint',repeat('b',64),'storageKey',storage,'profile',profile,'portraitType','image/jpeg','swimsuitType','image/png');
 if public.qoq_intake(secret,'create',req)->>'reference'<>ref then raise exception 'Receipt confirmation missing'; end if;
 if public.qoq_intake(secret,'create',req)<>'{}' then raise exception 'Duplicate request inserted'; end if;
 r:=public.qoq_intake(secret,'list','{"limit":1}');
 if jsonb_array_length(r->'applications')<>1 or (r->'applications'->0)?'email' then raise exception 'Unexpected listing'; end if;
 if public.qoq_intake(secret,'details',jsonb_build_object('reference',ref))->>'legalName'<>'Synthetic Applicant' then raise exception 'Application unavailable'; end if;
 if public.qoq_intake(secret,'withdrawal',jsonb_build_object('reference',ref,'requestKey',repeat('c',64)))<>'{}' then raise exception 'Invalid token accepted'; end if;
 if public.qoq_intake(secret,'withdrawal',jsonb_build_object('reference',ref,'requestKey',key))->>'storageKey'<>storage::text then raise exception 'Valid withdrawal token denied'; end if;
 perform public.qoq_intake(secret,'remove',jsonb_build_object('reference',ref,'storageKey',storage));
 if exists(select from qoq_private.applications) then raise exception 'Data cleanup failed';end if;
end $$;
rollback;
