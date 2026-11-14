-- Purchased-points voting: packages, orders, verified payment events and an append-only points ledger.
-- Fixed conversion: PHP 100 = 1,000 points, i.e. 10 centavos per point. Money is integer centavos; points are integers.
-- Nothing here can credit points without a provider event that the Worker has signature-verified
-- AND a provider configured in settings.payment_provider (null by default: payments are off).

create table qoq_private.packages (
  id uuid primary key default gen_random_uuid(),
  edition_id text not null default qoq_private.current_edition() references qoq_private.editions(id),
  name text not null check (length(trim(name)) between 1 and 60),
  points integer not null check (points between 1 and 10000000),
  price_centavos bigint not null,
  display_order int not null default 0,
  active boolean not null default true,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The conversion rate is a table constraint, not a convention.
  constraint packages_fixed_rate check (price_centavos = points::bigint * 10),
  constraint packages_archived_inactive check (archived_at is null or not active)
);
create unique index qoq_package_name on qoq_private.packages(edition_id,lower(trim(name))) where archived_at is null;

-- Initial catalog: proposals for organizer approval. Checkout stays off until approved.
insert into qoq_private.packages(name,points,price_centavos,display_order) values
  ('Starter',1000,10000,1),('Supporter',5000,50000,2),('Champion',10000,100000,3),
  ('Diamond',25000,250000,4),('Royal',50000,500000,5),('Crown',100000,1000000,6);

create table qoq_private.orders (
  id uuid primary key default gen_random_uuid(),
  public_ref text not null unique check (public_ref ~ '^QV-[A-F0-9]{32}$'),
  edition_id text not null default qoq_private.current_edition() references qoq_private.editions(id),
  candidate_id uuid not null references qoq_private.candidates(id),
  package_id uuid not null references qoq_private.packages(id),
  package_snapshot jsonb not null,
  points integer not null check (points>0),
  amount_centavos bigint not null check (amount_centavos>0),
  currency text not null default 'PHP' check (currency='PHP'),
  purchaser_email text not null check (length(purchaser_email)<=254),
  purchaser_name text check (purchaser_name is null or length(purchaser_name)<=120),
  idempotency_key text not null unique check (idempotency_key ~ '^[a-f0-9]{64}$'),
  provider text,
  provider_ref text,
  status text not null default 'created' check (status in
    ('created','awaiting_payment','processing','paid','failed','expired','cancelled','refunded','partially_refunded','reversed')),
  credit_status text not null default 'none' check (credit_status in ('none','credited','held','declined','reversed')),
  refunded_centavos bigint not null default 0 check (refunded_centavos>=0),
  flag text check (flag in ('amount_mismatch','double_payment','partial_refund_review','refund_without_payment')),
  flag_note text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  paid_at timestamptz,
  credited_at timestamptz,
  constraint orders_fixed_rate check (amount_centavos = points::bigint * 10),
  constraint orders_refund_cap check (refunded_centavos<=amount_centavos)
);
create unique index qoq_orders_provider_ref on qoq_private.orders(provider,provider_ref) where provider_ref is not null;
create index qoq_orders_candidate on qoq_private.orders(candidate_id);
create index qoq_orders_status on qoq_private.orders(edition_id,status,created_at desc);
create index qoq_orders_email on qoq_private.orders(lower(purchaser_email));

create function qoq_private.guard_order() returns trigger language plpgsql
set search_path=pg_catalog,pg_temp as $$
begin
  if tg_op='DELETE' then raise exception 'Orders are permanent records' using errcode='55000'; end if;
  if (old.id,old.public_ref,old.edition_id,old.candidate_id,old.package_id,old.package_snapshot,old.points,old.amount_centavos,old.currency,old.idempotency_key,old.created_at)
     is distinct from (new.id,new.public_ref,new.edition_id,new.candidate_id,new.package_id,new.package_snapshot,new.points,new.amount_centavos,new.currency,new.idempotency_key,new.created_at) then
    raise exception 'The purchased package, amount and recipient of an order are fixed' using errcode='55000';
  end if;
  if new.status<>old.status and not ((old.status,new.status) in (
    ('created','awaiting_payment'),('created','processing'),('created','paid'),('created','failed'),('created','expired'),('created','cancelled'),
    ('awaiting_payment','processing'),('awaiting_payment','paid'),('awaiting_payment','failed'),('awaiting_payment','expired'),('awaiting_payment','cancelled'),
    ('processing','paid'),('processing','failed'),('processing','expired'),('processing','cancelled'),
    -- A provider can capture a payment after the browser session failed or timed out.
    ('failed','paid'),('expired','paid'),('cancelled','paid'),
    ('paid','refunded'),('paid','partially_refunded'),('paid','reversed'),
    ('partially_refunded','refunded'),('partially_refunded','reversed'))) then
    raise exception 'Order status cannot move from % to %',old.status,new.status using errcode='55000';
  end if;
  if old.paid_at is not null and new.paid_at is distinct from old.paid_at then raise exception 'Settlement time is fixed' using errcode='55000'; end if;
  return new;
end $$;
create trigger qoq_order_guard before update or delete on qoq_private.orders for each row execute function qoq_private.guard_order();

-- Every signed provider notification, exactly once.
create table qoq_private.payment_events (
  id bigint generated always as identity primary key,
  provider text not null,
  provider_event_id text not null check (length(provider_event_id) between 1 and 200),
  order_id uuid references qoq_private.orders(id),
  order_ref text,
  type text not null check (type in ('processing','paid','failed','expired','cancelled','refunded','reversed')),
  amount_centavos bigint,
  currency text,
  provider_ref text,
  received_at timestamptz not null default now(),
  outcome text not null default 'received',
  unique(provider,provider_event_id)
);
create index qoq_payment_events_order on qoq_private.payment_events(order_id,id);

-- The authoritative points record. Rows are never edited or removed; corrections are new rows.
create table qoq_private.ledger (
  id bigint generated always as identity primary key,
  edition_id text not null default qoq_private.current_edition() references qoq_private.editions(id),
  candidate_id uuid not null references qoq_private.candidates(id),
  order_id uuid not null references qoq_private.orders(id),
  kind text not null check (kind in ('credit','reversal','adjustment')),
  points integer not null check (points<>0),
  payment_event_id bigint references qoq_private.payment_events(id),
  actor text not null,
  reason text check (reason is null or length(reason)<=500),
  created_at timestamptz not null default now(),
  constraint ledger_sign check ((kind='credit' and points>0) or (kind='reversal' and points<0) or kind='adjustment'),
  constraint ledger_adjustment_reason check (kind<>'adjustment' or length(trim(coalesce(reason,'')))>=10)
);
-- One credit per order, ever. A replayed or concurrent settlement cannot add a second one.
create unique index qoq_ledger_one_credit on qoq_private.ledger(order_id) where kind='credit';
create unique index qoq_ledger_one_reversal_per_event on qoq_private.ledger(payment_event_id) where kind='reversal';
create index qoq_ledger_candidate on qoq_private.ledger(candidate_id);

create function qoq_private.guard_ledger() returns trigger language plpgsql
set search_path=pg_catalog,pg_temp as $$
declare o qoq_private.orders%rowtype; net bigint;
begin
  select * into strict o from qoq_private.orders where id=new.order_id for update;
  if new.candidate_id<>o.candidate_id or new.edition_id<>o.edition_id then
    raise exception 'Points follow the candidate chosen on the order' using errcode='55000'; end if;
  if new.kind='credit' and new.points<>o.points then raise exception 'A credit equals the purchased package' using errcode='55000'; end if;
  select coalesce(sum(points),0)+new.points into net from qoq_private.ledger where order_id=new.order_id;
  if net<0 or net>o.points then raise exception 'An order can hold between zero and its purchased points' using errcode='55000'; end if;
  return new;
end $$;
create trigger qoq_ledger_guard before insert on qoq_private.ledger for each row execute function qoq_private.guard_ledger();
create trigger qoq_ledger_append_only before update or delete on qoq_private.ledger for each row execute function qoq_private.guard_append_only();

create table qoq_private.voting_snapshots (
  edition_id text primary key references qoq_private.editions(id),
  finalized_at timestamptz not null default now(),
  finalized_by text not null,
  report jsonb not null,
  digest text not null check (digest ~ '^[a-f0-9]{64}$')
);
create trigger qoq_voting_snapshot_immutable before update or delete on qoq_private.voting_snapshots for each row execute function qoq_private.guard_append_only();

do $$ declare t text; begin
  foreach t in array array['packages','orders','payment_events','ledger','voting_snapshots'] loop
    execute format('alter table qoq_private.%I enable row level security',t);
  end loop;
end $$;

-- Derived views of the ledger -------------------------------------------------
create function qoq_private.point_totals() returns jsonb language sql stable set search_path=pg_catalog,pg_temp as $$
  with t as (
    select c.id,c.number,c.name,coalesce(sum(l.points),0)::bigint pts,
      (select count(*) from qoq_private.orders o where o.candidate_id=c.id and o.credit_status='credited'
         and (select coalesce(sum(points),0) from qoq_private.ledger x where x.order_id=o.id)>0) purchases
    from qoq_private.candidates c left join qoq_private.ledger l on l.candidate_id=c.id
    where c.status='active' group by c.id
  ), g as (select coalesce(sum(pts),0) total from t)
  select coalesce(jsonb_agg(jsonb_build_object('candidateId',id,'number',number,'name',name,'points',pts,'purchases',purchases,
    'share',case when g.total>0 then round(pts*100.0/g.total,2) else 0 end,
    'rank',rnk,'tied',ties>1 and pts>0,
    'packages',(select coalesce(jsonb_agg(jsonb_build_object('name',p.n,'count',p.c,'points',p.s) order by p.s desc,p.n),'[]') from
       (select o.package_snapshot->>'name' n,count(distinct o.id) c,sum(x.points) s from qoq_private.ledger x join qoq_private.orders o on o.id=x.order_id
        where x.candidate_id=r.id group by 1 having sum(x.points)>0) p))
    order by rnk,number nulls last,name,id),'[]')
  from (select t.*,rank() over (order by pts desc) rnk,count(*) over (partition by pts) ties from t) r, g
$$;

-- Independent cross-checks between orders, provider events and the ledger. An empty list means reconciled.
create function qoq_private.reconcile() returns jsonb language sql stable set search_path=pg_catalog,pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('orderRef',ref,'issue',issue) order by ref,issue),'[]') from (
    select o.public_ref ref,'credited order has no matching credit entry' issue from qoq_private.orders o
      where o.credit_status='credited' and not exists(select 1 from qoq_private.ledger l where l.order_id=o.id and l.kind='credit' and l.points=o.points and l.candidate_id=o.candidate_id)
    union all
    select o.public_ref,'credit entry exists for an order that was never settled' from qoq_private.orders o
      where o.paid_at is null and exists(select 1 from qoq_private.ledger l where l.order_id=o.id)
    union all
    select o.public_ref,'credit status does not match the ledger' from qoq_private.orders o
      where o.credit_status in ('none','held','declined') and exists(select 1 from qoq_private.ledger l where l.order_id=o.id)
    union all
    select o.public_ref,'points on the order differ from the package purchased' from qoq_private.orders o
      where o.points<>(o.package_snapshot->>'points')::int or o.amount_centavos<>(o.package_snapshot->>'priceCentavos')::bigint
    union all
    select o.public_ref,'refunded or reversed payment still holds points' from qoq_private.orders o
      where o.status in ('refunded','reversed') and (select coalesce(sum(points),0) from qoq_private.ledger l where l.order_id=o.id)<>0
    union all
    select o.public_ref,'settled payment has no decision on its points' from qoq_private.orders o
      where o.paid_at is not null and o.status='paid' and o.credit_status='none'
    union all
    select o.public_ref,'paid outside the voting period: awaiting organizer decision' from qoq_private.orders o where o.credit_status='held'
    union all
    select o.public_ref,'unresolved flag: '||o.flag from qoq_private.orders o where o.flag is not null
    union all
    select coalesce(e.order_ref,'(none)'),'provider event '||e.provider_event_id||' matched no order' from qoq_private.payment_events e where e.outcome='unmatched'
    union all
    select '(ledger)','candidate totals do not equal the sum of order balances' where
      (select coalesce(sum(points),0) from qoq_private.ledger)<>
      (select coalesce(sum(n),0) from (select (select coalesce(sum(points),0) from qoq_private.ledger l where l.order_id=o.id) n from qoq_private.orders o) x)
  ) i
$$;

create function qoq_private.order_view(o qoq_private.orders,private boolean) returns jsonb language sql stable set search_path=pg_catalog,pg_temp as $$
  select jsonb_build_object('orderRef',o.public_ref,'status',o.status,'creditStatus',o.credit_status,'points',o.points,
    'amountCentavos',o.amount_centavos,'currency',o.currency,'package',o.package_snapshot->>'name',
    'candidate',(select jsonb_build_object('number',number,'name',name) from qoq_private.candidates where id=o.candidate_id),
    'createdAt',o.created_at,'expiresAt',o.expires_at,'paidAt',o.paid_at,'creditedAt',o.credited_at)
  || case when private then jsonb_build_object('email',o.purchaser_email,'name',o.purchaser_name,'provider',o.provider,'providerRef',o.provider_ref,
       'refundedCentavos',o.refunded_centavos,'flag',o.flag,'flagNote',o.flag_note,
       'netPoints',(select coalesce(sum(points),0) from qoq_private.ledger where order_id=o.id)) else '{}'::jsonb end
$$;

create function public.qoq_points(p_secret text,p_actor text,p_email text,p_organizer boolean,p_action text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare
  s qoq_private.settings%rowtype; o qoq_private.orders%rowtype; pk qoq_private.packages%rowtype; ev qoq_private.payment_events%rowtype;
  actor text:=trim(coalesce(p_actor,'')); mail text; nm text; item uuid; cand uuid; n int; net bigint; amt bigint;
  typ text; reason text; issues jsonb; report jsonb; res text; tmp timestamptz; tmp2 timestamptz; q text; want text; last_at timestamptz;
begin
  if not public.qoq_media_authorized(p_secret) then raise exception 'Access denied' using errcode='42501'; end if;
  if p_action is null or jsonb_typeof(coalesce(p_data,'{}'))<>'object' or octet_length(coalesce(p_data,'{}')::text)>20000 then raise exception 'Invalid request data' using errcode='22023'; end if;
  p_data:=coalesce(p_data,'{}');
  if p_action like 'organizer.%' and (p_organizer is not true or actor='' or trim(coalesce(p_email,''))='') then raise exception 'Organizer access required' using errcode='42501'; end if;
  -- State changes take the settings row exclusively, so a close or finalize never interleaves with a settlement.
  if p_action like 'organizer.%' and p_action not in ('organizer.voting','organizer.orders','organizer.order') then
    select * into strict s from qoq_private.settings where singleton for update;
  else
    select * into strict s from qoq_private.settings where singleton for share;
  end if;

  case p_action
  when 'public.catalog' then
    return jsonb_build_object(
      'edition',(select jsonb_build_object('name',name,'theme',theme) from qoq_private.editions where is_current),
      'voting',s.voting,'opensAt',s.voting_opens_at,'closesAt',s.voting_closes_at,
      'paymentsEnabled',s.payments_enabled and s.payment_provider is not null and s.packages_approved_at is not null,
      'rate',jsonb_build_object('pesos',100,'points',1000),'pointsPublic',s.points_public,
      'packages',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'points',points,'priceCentavos',price_centavos) order by display_order,points,id),'[]')
        from qoq_private.packages where active and archived_at is null),
      'candidates',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'number',c.number,'name',c.name,'photoKey',c.photo_key,'bio',c.bio)
          || case when s.points_public then jsonb_build_object('points',(select coalesce(sum(points),0) from qoq_private.ledger l where l.candidate_id=c.id)) else '{}'::jsonb end
          order by c.number nulls last,c.name,c.id),'[]')
        from qoq_private.candidates c where c.published and c.status='active'));

  when 'order.create' then
    -- "gate" is set by the Worker from its own deployment flag; request bodies cannot supply it.
    if p_data->>'gate' is distinct from 'open' or not s.payments_enabled or s.payment_provider is null or s.packages_approved_at is null then
      raise exception 'Online payment is coming soon. No purchase was created.' using errcode='55000'; end if;
    if s.voting<>'open' or (s.voting_opens_at is not null and clock_timestamp()<s.voting_opens_at)
       or (s.voting_closes_at is not null and clock_timestamp()>=s.voting_closes_at) then
      raise exception 'Voting is not open' using errcode='55000'; end if;
    mail:=lower(trim(coalesce(p_data->>'email',''))); nm:=nullif(trim(coalesce(p_data->>'name','')),'');
    if length(mail)>254 or mail!~'^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' or length(coalesce(nm,''))>120 then
      raise exception 'Enter a valid email address for your receipt' using errcode='22023'; end if;
    if coalesce(p_data->>'idempotencyKey','')!~'^[a-f0-9]{64}$' then raise exception 'Reload the page and try again' using errcode='22023'; end if;
    cand:=(p_data->>'candidateId')::uuid; item:=(p_data->>'packageId')::uuid;
    select * into o from qoq_private.orders where idempotency_key=p_data->>'idempotencyKey';
    if found then
      if o.candidate_id<>cand or o.package_id<>item or o.purchaser_email<>mail then raise exception 'This purchase was already started with different details' using errcode='23505'; end if;
      return qoq_private.order_view(o,false);
    end if;
    if not exists(select 1 from qoq_private.candidates where id=cand and published and status='active') then raise exception 'Choose an official candidate' using errcode='22023'; end if;
    select * into pk from qoq_private.packages where id=item and active and archived_at is null;
    if not found then raise exception 'Choose an available voting package' using errcode='22023'; end if;
    if (select count(*) from qoq_private.orders where lower(purchaser_email)=mail and status in ('created','awaiting_payment') and expires_at>clock_timestamp())>=5 then
      raise exception 'Finish or wait for your pending purchases before starting another' using errcode='55000'; end if;
    insert into qoq_private.orders(public_ref,candidate_id,package_id,package_snapshot,points,amount_centavos,purchaser_email,purchaser_name,idempotency_key,provider,expires_at)
    values('QV-'||upper(replace(gen_random_uuid()::text,'-','')),cand,pk.id,
      jsonb_build_object('id',pk.id,'name',pk.name,'points',pk.points,'priceCentavos',pk.price_centavos,'approvedAt',s.packages_approved_at),
      pk.points,pk.price_centavos,mail,nm,p_data->>'idempotencyKey',s.payment_provider,
      least(clock_timestamp()+interval '30 minutes',coalesce(s.voting_closes_at,'infinity')))
    on conflict(idempotency_key) do nothing returning * into o;
    if not found then select * into strict o from qoq_private.orders where idempotency_key=p_data->>'idempotencyKey'; end if;
    return qoq_private.order_view(o,false);

  when 'order.attach' then  -- Worker only: the provider accepted the checkout.
    select * into o from qoq_private.orders where public_ref=p_data->>'orderRef' for update;
    if not found or o.status<>'created' then raise exception 'Order unavailable' using errcode='55000'; end if;
    update qoq_private.orders set status='awaiting_payment',provider_ref=nullif(p_data->>'providerRef','') where id=o.id returning * into o;
    return qoq_private.order_view(o,false);

  when 'order.status' then
    select * into o from qoq_private.orders where public_ref=p_data->>'orderRef';
    if not found then raise exception 'Order not found' using errcode='22023'; end if;
    return qoq_private.order_view(o,false);

  when 'payment.event' then
    -- Reached only after the Worker verified the provider signature over the raw body.
    typ:=p_data->>'type';
    if s.payment_provider is null or p_data->>'provider' is distinct from s.payment_provider then
      raise exception 'No payment provider is active' using errcode='42501'; end if;
    if coalesce(p_data->>'eventId','')='' or length(p_data->>'eventId')>200 or typ is null then raise exception 'Invalid payment event' using errcode='22023'; end if;
    amt:=(p_data->>'amountCentavos')::bigint;
    insert into qoq_private.payment_events(provider,provider_event_id,order_ref,type,amount_centavos,currency,provider_ref)
      values(s.payment_provider,p_data->>'eventId',p_data->>'orderRef',typ,amt,p_data->>'currency',nullif(p_data->>'providerRef',''))
      on conflict(provider,provider_event_id) do nothing returning * into ev;
    if not found then return jsonb_build_object('ok',true,'duplicate',true); end if;
    select * into o from qoq_private.orders where public_ref=p_data->>'orderRef' for update;
    if not found then
      update qoq_private.payment_events set outcome='unmatched' where id=ev.id;
      return jsonb_build_object('ok',true,'outcome','unmatched');
    end if;
    res:='applied';
    if typ='paid' then
      if amt is distinct from o.amount_centavos or p_data->>'currency' is distinct from o.currency then
        res:='amount_mismatch';
        update qoq_private.orders set flag='amount_mismatch',flag_note='Provider reported '||coalesce(amt::text,'?')||' '||coalesce(p_data->>'currency','?') where id=o.id;
      elsif o.paid_at is not null then
        if ev.provider_ref is not distinct from o.provider_ref then res:='already_settled';
        else res:='double_payment';
          update qoq_private.orders set flag='double_payment',flag_note='Second payment '||coalesce(ev.provider_ref,'?')||' needs a refund at the provider' where id=o.id;
        end if;
      else
        update qoq_private.orders set status='paid',paid_at=clock_timestamp(),provider_ref=coalesce(ev.provider_ref,provider_ref) where id=o.id;
        if s.voting='open' and (s.voting_closes_at is null or clock_timestamp()<s.voting_closes_at) then
          insert into qoq_private.ledger(candidate_id,order_id,kind,points,payment_event_id,actor) values(o.candidate_id,o.id,'credit',o.points,ev.id,'provider:'||s.payment_provider);
          update qoq_private.orders set credit_status='credited',credited_at=clock_timestamp() where id=o.id;
          res:='credited';
        else
          -- Settled after voting closed. No rule is assumed: the organizer decides, on the record.
          update qoq_private.orders set credit_status='held' where id=o.id;
          res:='held';
        end if;
      end if;
    elsif typ='processing' then
      if o.status in ('created','awaiting_payment') then update qoq_private.orders set status='processing' where id=o.id; else res:='ignored'; end if;
    elsif typ in ('failed','expired','cancelled') then
      if o.status in ('created','awaiting_payment','processing') then update qoq_private.orders set status=typ where id=o.id; else res:='ignored'; end if;
    elsif typ in ('refunded','reversed') then
      if o.paid_at is null then
        res:='refund_without_payment';
        update qoq_private.orders set flag='refund_without_payment',flag_note='A '||typ||' event arrived before any settlement' where id=o.id;
      elsif o.status in ('refunded','reversed') then res:='ignored';
      else
        select coalesce(sum(points),0) into net from qoq_private.ledger where order_id=o.id;
        if typ='reversed' or coalesce(amt,o.amount_centavos)+o.refunded_centavos>=o.amount_centavos then
          if net>0 then insert into qoq_private.ledger(candidate_id,order_id,kind,points,payment_event_id,actor,reason)
            values(o.candidate_id,o.id,'reversal',-net,ev.id,'provider:'||s.payment_provider,typ); end if;
          update qoq_private.orders set status=typ,refunded_centavos=case when typ='refunded' then amount_centavos else refunded_centavos end,
            credit_status=case when credit_status='credited' then 'reversed' when credit_status='held' then 'declined' else credit_status end where id=o.id;
          res:=case when s.voting='finalized' then 'reversed_after_finalization' else 'reversed' end;
        elsif coalesce(amt,0)<=0 then res:='ignored';
        else
          -- Partial refund: no proportional rule is assumed. Points stay until an audited organizer adjustment.
          update qoq_private.orders set status='partially_refunded',refunded_centavos=refunded_centavos+amt,flag='partial_refund_review',
            flag_note='Partial refund of '||amt||' centavos: adjust points or confirm they stand' where id=o.id;
          res:='partial_refund_review';
        end if;
      end if;
    else raise exception 'Invalid payment event' using errcode='22023';
    end if;
    update qoq_private.payment_events set outcome=res,order_id=o.id where id=ev.id;
    perform qoq_private.log('provider:'||s.payment_provider,'payment.'||typ,o.id,jsonb_build_object('orderRef',o.public_ref,'outcome',res,'eventId',ev.provider_event_id));
    return jsonb_build_object('ok',true,'outcome',res);
  else null;
  end case;

  if p_action not like 'organizer.%' then raise exception 'Unknown action' using errcode='22023'; end if;

  case p_action
  when 'organizer.voting' then
    return jsonb_build_object(
      'state',jsonb_build_object('voting',s.voting,'opensAt',s.voting_opens_at,'closesAt',s.voting_closes_at,'openedAt',s.voting_opened_at,'closedAt',s.voting_closed_at,
        'finalizedAt',s.voting_finalized_at,'paymentsEnabled',s.payments_enabled,'providerConfigured',s.payment_provider is not null,
        'packagesApprovedAt',s.packages_approved_at,'pointsPublic',s.points_public),
      'metrics',(select jsonb_build_object(
          'grossCentavos',coalesce(sum(amount_centavos) filter (where paid_at is not null),0),
          'refundedCentavos',coalesce(sum(refunded_centavos) filter (where status<>'reversed'),0),
          'reversedCentavos',coalesce(sum(amount_centavos-refunded_centavos) filter (where status='reversed'),0),
          'settledOrders',count(*) filter (where paid_at is not null),
          'pendingOrders',count(*) filter (where status in ('created','awaiting_payment','processing') and (status='processing' or expires_at>clock_timestamp())),
          'failedOrders',count(*) filter (where status in ('failed','expired','cancelled') or (status in ('created','awaiting_payment') and expires_at<=clock_timestamp())),
          'heldOrders',count(*) filter (where credit_status='held')) from qoq_private.orders)
        || jsonb_build_object('creditedPoints',(select coalesce(sum(points),0) from qoq_private.ledger)),
      'candidates',qoq_private.point_totals(),
      'packages',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'points',p.points,'priceCentavos',p.price_centavos,'displayOrder',p.display_order,
          'active',p.active,'archived',p.archived_at is not null,
          'settledOrders',(select count(*) from qoq_private.orders x where x.package_id=p.id and x.paid_at is not null)) order by p.archived_at nulls first,p.display_order,p.points),'[]')
        from qoq_private.packages p),
      'issues',qoq_private.reconcile(),
      'snapshot',(select jsonb_build_object('finalizedAt',finalized_at,'finalizedBy',finalized_by,'digest',digest,'report',v.report) from qoq_private.voting_snapshots v where v.edition_id=s.edition_id));

  when 'organizer.orders' then
    n:=coalesce((p_data->>'limit')::int,25); want:=nullif(p_data->>'status',''); q:=nullif(trim(coalesce(p_data->>'q','')),'');
    last_at:=coalesce((p_data->>'before')::timestamptz,'infinity');
    if n not between 1 and 100 or length(coalesce(q,''))>120 then raise exception 'Invalid page' using errcode='22023'; end if;
    if q is not null then q:='%'||replace(replace(replace(q,'\','\\'),'%','\%'),'_','\_')||'%'; end if;
    return jsonb_build_object('orders',(select coalesce(jsonb_agg(qoq_private.order_view(x,true) order by x.created_at desc,x.id),'[]') from
      (select * from qoq_private.orders r where r.created_at<last_at and (want is null or r.status=want or (want='flagged' and r.flag is not null) or (want='held' and r.credit_status='held'))
        and (q is null or r.public_ref ilike q or r.provider_ref ilike q or r.purchaser_email ilike q)
        order by r.created_at desc,r.id limit n) x));

  when 'organizer.order' then
    select * into o from qoq_private.orders where public_ref=p_data->>'orderRef';
    if not found then raise exception 'Order not found' using errcode='22023'; end if;
    return jsonb_build_object('order',qoq_private.order_view(o,true),
      'events',(select coalesce(jsonb_agg(jsonb_build_object('eventId',provider_event_id,'type',type,'amountCentavos',amount_centavos,'receivedAt',received_at,'outcome',e.outcome) order by e.id),'[]')
        from qoq_private.payment_events e where e.order_id=o.id),
      'ledger',(select coalesce(jsonb_agg(jsonb_build_object('kind',kind,'points',points,'actor',l.actor,'reason',l.reason,'at',created_at) order by l.id),'[]')
        from qoq_private.ledger l where l.order_id=o.id));

  when 'organizer.exportOrders' then
    perform qoq_private.log(actor,'orders.export',null,null);
    return jsonb_build_object('rows',(select coalesce(jsonb_agg(qoq_private.order_view(x,true) order by x.created_at,x.id),'[]')
      from (select * from qoq_private.orders order by created_at,id limit 5000) x));

  when 'organizer.package' then
    if s.voting not in ('not_configured','scheduled') then raise exception 'The package catalog is fixed once voting opens. Archive a package instead.' using errcode='55000'; end if;
    item:=(p_data->>'id')::uuid; nm:=trim(coalesce(p_data->>'name',''));
    if length(nm) not between 1 and 60 or jsonb_typeof(p_data->'points') is distinct from 'number' or (p_data->>'points')::numeric<>trunc((p_data->>'points')::numeric)
       or (p_data->>'points')::numeric not between 1 and 10000000 then
      raise exception 'Enter a package name and a whole number of points' using errcode='22023'; end if;
    n:=(p_data->>'points')::int;
    -- The price is never accepted from the request. It is always points x 10 centavos (PHP 100 per 1,000 points).
    if item is null then
      insert into qoq_private.packages(name,points,price_centavos,display_order,active)
        values(nm,n,n::bigint*10,coalesce((p_data->>'displayOrder')::int,0),coalesce((p_data->>'active')::boolean,true)) returning id into item;
    else
      select * into pk from qoq_private.packages where id=item and archived_at is null for update;
      if not found then raise exception 'Unknown package' using errcode='22023'; end if;
      if pk.points<>n and exists(select 1 from qoq_private.orders where package_id=item) then
        raise exception 'This package has purchases. Archive it and create a new one instead.' using errcode='55000'; end if;
      update qoq_private.packages set name=nm,points=n,price_centavos=n::bigint*10,display_order=coalesce((p_data->>'displayOrder')::int,display_order),
        active=coalesce((p_data->>'active')::boolean,active),updated_at=clock_timestamp() where id=item;
    end if;
    -- Any catalog change withdraws approval, and with it checkout.
    update qoq_private.settings set packages_approved_at=null,payments_enabled=false where singleton;
    perform qoq_private.log(actor,p_action,item,jsonb_build_object('name',nm,'points',n,'priceCentavos',n::bigint*10));
    return jsonb_build_object('ok',true,'id',item);

  when 'organizer.archivePackage' then
    item:=(p_data->>'id')::uuid;
    update qoq_private.packages set active=false,archived_at=clock_timestamp(),updated_at=clock_timestamp() where id=item and archived_at is null;
    if not found then raise exception 'Unknown package' using errcode='22023'; end if;
    perform qoq_private.log(actor,p_action,item,null);
    return jsonb_build_object('ok',true);

  when 'organizer.approvePackages' then
    if not exists(select 1 from qoq_private.packages where active and archived_at is null) then raise exception 'Add at least one active package first' using errcode='55000'; end if;
    update qoq_private.settings set packages_approved_at=clock_timestamp() where singleton;
    perform qoq_private.log(actor,p_action,null,(select jsonb_agg(jsonb_build_object('name',name,'points',points,'priceCentavos',price_centavos) order by display_order,points)
      from qoq_private.packages where active and archived_at is null));
    return jsonb_build_object('ok',true);

  when 'organizer.scheduleVoting' then
    if s.voting not in ('not_configured','scheduled') then raise exception 'The voting schedule is fixed once voting opens' using errcode='55000'; end if;
    tmp:=(p_data->>'opensAt')::timestamptz; tmp2:=(p_data->>'closesAt')::timestamptz;
    if tmp is not null and tmp2 is not null and tmp2<=tmp then raise exception 'The closing time must be after the opening time' using errcode='22023'; end if;
    update qoq_private.settings set voting=case when tmp is null and tmp2 is null then 'not_configured' else 'scheduled' end,voting_opens_at=tmp,voting_closes_at=tmp2 where singleton;
    perform qoq_private.log(actor,p_action,null,jsonb_build_object('opensAt',tmp,'closesAt',tmp2));
    return jsonb_build_object('ok',true);

  when 'organizer.openVoting' then
    if s.voting not in ('not_configured','scheduled') then raise exception 'Voting has already opened for this edition' using errcode='55000'; end if;
    update qoq_private.settings set voting='open' where singleton;
    perform qoq_private.log(actor,p_action,null,null);
    return jsonb_build_object('ok',true);

  when 'organizer.closeVoting' then
    if s.voting<>'open' then raise exception 'Voting is not open' using errcode='55000'; end if;
    update qoq_private.settings set voting='closed' where singleton;
    perform qoq_private.log(actor,p_action,null,null);
    return jsonb_build_object('ok',true);

  when 'organizer.setPayments' then
    if jsonb_typeof(p_data->'enabled') is distinct from 'boolean' then raise exception 'Choose on or off' using errcode='22023'; end if;
    if (p_data->>'enabled')::boolean and s.voting in ('closed','finalized') then
      raise exception 'Voting has ended for this edition. Payments stay off.' using errcode='55000'; end if;
    if (p_data->>'enabled')::boolean and (s.payment_provider is null or s.packages_approved_at is null) then
      raise exception 'Payments stay off until a provider is configured and the package catalog is approved' using errcode='55000'; end if;
    update qoq_private.settings set payments_enabled=(p_data->>'enabled')::boolean where singleton;
    perform qoq_private.log(actor,p_action,null,jsonb_build_object('enabled',p_data->'enabled'));
    return jsonb_build_object('ok',true);

  when 'organizer.setPointsPublic' then
    if jsonb_typeof(p_data->'enabled') is distinct from 'boolean' then raise exception 'Choose on or off' using errcode='22023'; end if;
    update qoq_private.settings set points_public=(p_data->>'enabled')::boolean where singleton;
    perform qoq_private.log(actor,p_action,null,jsonb_build_object('enabled',p_data->'enabled'));
    return jsonb_build_object('ok',true);

  when 'organizer.resolveHeld','organizer.adjust','organizer.resolveFlag' then
    reason:=trim(coalesce(p_data->>'reason',''));
    if length(reason) not between 10 and 500 then raise exception 'Record a reason of at least 10 characters' using errcode='22023'; end if;
    if s.voting='finalized' then raise exception 'Voting is finalized. The points record is closed.' using errcode='55000'; end if;
    select * into o from qoq_private.orders where public_ref=p_data->>'orderRef' for update;
    if not found then raise exception 'Order not found' using errcode='22023'; end if;
    if p_action='organizer.resolveHeld' then
      if o.credit_status<>'held' then raise exception 'This order is not waiting for a decision' using errcode='55000'; end if;
      if p_data->>'decision'='credit' then
        insert into qoq_private.ledger(candidate_id,order_id,kind,points,actor,reason) values(o.candidate_id,o.id,'credit',o.points,actor,reason);
        update qoq_private.orders set credit_status='credited',credited_at=clock_timestamp() where id=o.id;
      elsif p_data->>'decision'='decline' then update qoq_private.orders set credit_status='declined',flag_note=reason where id=o.id;
      else raise exception 'Choose credit or decline' using errcode='22023'; end if;
    elsif p_action='organizer.adjust' then
      -- Bounded correction tied to a settled order. The ledger trigger keeps the order between 0 and its purchased points.
      if o.paid_at is null or o.credit_status<>'credited' then raise exception 'Only a settled, credited order can be adjusted' using errcode='55000'; end if;
      if jsonb_typeof(p_data->'points') is distinct from 'number' or (p_data->>'points')::numeric<>trunc((p_data->>'points')::numeric) or (p_data->>'points')::numeric=0 then
        raise exception 'Enter a whole, non-zero number of points' using errcode='22023'; end if;
      insert into qoq_private.ledger(candidate_id,order_id,kind,points,actor,reason) values(o.candidate_id,o.id,'adjustment',(p_data->>'points')::int,actor,reason);
    else
      if o.flag is null then raise exception 'This order has no open flag' using errcode='55000'; end if;
      update qoq_private.orders set flag=null,flag_note=reason where id=o.id;
    end if;
    perform qoq_private.log(actor,p_action,o.id,jsonb_build_object('orderRef',o.public_ref,'reason',reason,'decision',p_data->>'decision','points',p_data->'points','flag',o.flag));
    return jsonb_build_object('ok',true);

  when 'organizer.finalizeVoting' then
    if s.voting<>'closed' then raise exception 'Close voting before finalizing it' using errcode='55000'; end if;
    update qoq_private.orders set status='expired' where status in ('created','awaiting_payment') and expires_at<=clock_timestamp();
    if exists(select 1 from qoq_private.orders where status in ('created','awaiting_payment','processing')) then
      raise exception 'Some payments are still pending at the provider. Wait for them to settle or expire.' using errcode='55000'; end if;
    issues:=qoq_private.reconcile();
    if jsonb_array_length(issues)>0 then raise exception 'Resolve every reconciliation issue before finalizing' using errcode='55000'; end if;
    report:=jsonb_build_object('edition',s.edition_id,'closedAt',s.voting_closed_at,'rate','PHP 100 = 1,000 points','totals',qoq_private.point_totals(),
      'creditedPoints',(select coalesce(sum(points),0) from qoq_private.ledger),'ledgerEntries',(select count(*) from qoq_private.ledger),
      'lastLedgerId',(select max(id) from qoq_private.ledger),
      'settledOrders',(select count(*) from qoq_private.orders where paid_at is not null),
      'grossCentavos',(select coalesce(sum(amount_centavos),0) from qoq_private.orders where paid_at is not null),
      'excluded',(select coalesce(jsonb_agg(jsonb_build_object('orderRef',public_ref,'status',status,'creditStatus',credit_status) order by created_at),'[]')
        from qoq_private.orders where paid_at is not null and credit_status<>'credited'));
    insert into qoq_private.voting_snapshots(edition_id,finalized_by,report,digest) values(s.edition_id,actor,report,encode(sha256(convert_to(report::text,'utf8')),'hex'));
    update qoq_private.settings set voting='finalized',payments_enabled=false where singleton;
    perform qoq_private.log(actor,p_action,null,jsonb_build_object('digest',encode(sha256(convert_to(report::text,'utf8')),'hex')));
    return jsonb_build_object('ok',true);
  else raise exception 'Unknown action' using errcode='22023';
  end case;
end $$;

revoke all on all tables in schema qoq_private from public,anon,authenticated;
revoke all on all sequences in schema qoq_private from public,anon,authenticated;
revoke all on all functions in schema qoq_private from public,anon,authenticated;
revoke all on function public.qoq_points(text,text,text,boolean,text,jsonb) from public,anon,authenticated;
grant execute on function public.qoq_points(text,text,text,boolean,text,jsonb) to anon;
