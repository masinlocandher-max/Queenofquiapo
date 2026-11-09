-- A permissive policy maintained for another project bucket must not grant direct
-- client access to pageant photos. Only the private service-role Edge function
-- reads and writes these objects. Other buckets retain their existing policies.
create policy qoq_media_no_direct_object_access on storage.objects
  as restrictive for all to anon, authenticated
  using (bucket_id <> 'qoq-private-media')
  with check (bucket_id <> 'qoq-private-media');
create policy qoq_media_no_direct_bucket_access on storage.buckets
  as restrictive for all to anon, authenticated
  using (id <> 'qoq-private-media')
  with check (id <> 'qoq-private-media');
