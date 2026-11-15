-- Stone package names and PHP 100 minimum, requested by the organizer.
begin;
lock table qoq_private.packages in share row exclusive mode;

alter table qoq_private.packages
  add constraint packages_minimum_php_100
  check (points >= 1000 and price_centavos >= 10000);

-- Free the existing Diamond name before assigning it to the largest package.
do $$
declare r record; new_name text;
begin
  for r in select * from qoq_private.packages
    where edition_id=qoq_private.current_edition() and archived_at is null
    order by case when name='Diamond' and points=25000 then 0 else 1 end, display_order
  loop
    new_name := case
      when r.name='Starter' and r.points=1000 then 'Quartz'
      when r.name='Supporter' and r.points=5000 then 'Amethyst'
      when r.name='Champion' and r.points=10000 then 'Sapphire'
      when r.name='Diamond' and r.points=25000 then 'Emerald'
      when r.name='Royal' and r.points=50000 then 'Ruby'
      when r.name='Crown' and r.points=100000 then 'Diamond'
      else r.name end;
    if new_name <> r.name then
      update qoq_private.packages set name=new_name, updated_at=clock_timestamp() where id=r.id;
      perform qoq_private.log('deployment:user-request','package.rename',r.id,
        jsonb_build_object('previousName',r.name,'name',new_name,'points',r.points,
          'priceCentavos',r.price_centavos,'reason','Organizer requested stone names and PHP 100 minimum'));
    end if;
  end loop;
end $$;

update qoq_private.settings set packages_approved_at=null,payments_enabled=false where singleton;
-- Orders and their historical package snapshots are intentionally untouched.
commit;
