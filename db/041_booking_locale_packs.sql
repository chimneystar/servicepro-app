-- =====================================================================
--  ServicePro — Migration 041
--  Bookable services come from the trades the business actually chose,
--  in BOTH languages, and the Hebrew name can correct itself.
--
--  Closes two seeding defects from the owner's audit (2026-07-31):
--
--  A5  `db/020_booking_experience.sql:78-79` seeded `booking_services.name_he`
--      from `jt.name` — the ENGLISH job-type name — and the sync trigger's
--      `on conflict do update` touched `name_en` only. The Hebrew name was
--      therefore wrong from the first insert AND could never self-correct,
--      however many times the trigger ran. Hebrew customers read English.
--
--  A6  `db/005_more.sql:8` defaults `organizations.job_types` to a fixed HVAC
--      list and `006` turned that list into rows, so every business published
--      the same menu — a chimney sweep advertised "AC Install". Meanwhile the
--      twelve fully bilingual trade packs in `lib/industry-packs.ts` fed the
--      price book only and were never wired into `job_types`.
--
--  ---------------------------------------------------------------------
--  WHAT HAPPENS TO AN ORGANISATION THAT ALREADY HAS JOB TYPES
--  ---------------------------------------------------------------------
--  Its service LIST is left exactly as it is. Section 6 seeds job types only
--  where `not exists (select 1 from job_types where organization_id = ...)`,
--  so an org with even one job type is skipped entirely: nothing is added,
--  nothing is removed, nothing is renumbered. Overwriting a live, published
--  service list — the list customers are booking from and that jobs, leads and
--  booking deposits already point at by id — would be a worse defect than the
--  one being fixed. A business that wants the pack menu adds it from
--  Settings → Job types.
--
--  What DOES change for an existing org is spelling, never offering: a
--  `name_he` that is null or identical to `name_en` is a mis-seed by
--  definition, and is replaced with the real Hebrew name when one is known.
--  A Hebrew name a human typed is never touched (sections 4 and 7).
--
--  ---------------------------------------------------------------------
--  Idempotent. Additive. DROPS NOTHING — no table, column, policy, index,
--  trigger, function or row is dropped. The 020 trigger is amended with
--  `create or replace trigger` (PostgreSQL 14+) precisely so that it is
--  replaced in place rather than dropped and recreated.
--  Requires: 006_job_types.sql, 018_product_foundation.sql,
--            020_booking_experience.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Refuse to run against a database that does not have what we amend,
--    rather than half-applying and leaving a puzzle behind.
-- ---------------------------------------------------------------------
do $$
begin
  if to_regclass('public.job_types') is null then
    raise exception 'migration 041 requires 006_job_types.sql (public.job_types is missing)';
  end if;
  if to_regclass('public.booking_services') is null then
    raise exception 'migration 041 requires 020_booking_experience.sql (public.booking_services is missing)';
  end if;
  if to_regclass('public.organization_industries') is null then
    raise exception 'migration 041 requires 018_product_foundation.sql (public.organization_industries is missing)';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. The bilingual trade catalogue, in the database.
--
--    `lib/industry-packs.ts` is the source of truth for the wording and is
--    mirrored here row for row (tests/booking-locale.test.mjs asserts the two
--    are identical, so they cannot drift). It has to exist in SQL because the
--    sync trigger and the repair function need to translate a service name
--    without a round trip through the application — the trigger is what makes
--    the Hebrew name self-correcting.
--
--    This is reference data shared by every tenant, not tenant data: there is
--    no organization_id and nothing here identifies a business.
-- ---------------------------------------------------------------------
create table if not exists public.industry_pack_services (
  pack_key      text not null,
  item_key      text not null,
  name_en       text not null,
  name_he       text not null,
  sort          integer not null default 0,
  -- Same shape as price_book.pack_item_key (`<pack>:<kind>:<item>`), so a job
  -- type and its price-book line can be recognised as the same pack item.
  pack_item_key text generated always as (pack_key || ':service:' || item_key) stored,
  primary key (pack_key, item_key)
);
create unique index if not exists uq_industry_pack_services_item
  on public.industry_pack_services(pack_item_key);

alter table public.industry_pack_services enable row level security;

-- Guarded create instead of drop-then-create: this migration drops nothing.
do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'industry_pack_services'
       and policyname = 'industry_pack_services_read'
  ) then
    create policy industry_pack_services_read on public.industry_pack_services
      for select to authenticated using (true);
  end if;
end $$;

revoke all on public.industry_pack_services from anon;
grant select on public.industry_pack_services to authenticated;
grant all on public.industry_pack_services to service_role;

-- Re-running this migration refreshes the wording; it never removes a row, so
-- a business whose services point at a pack item cannot lose its translation.
insert into public.industry_pack_services (pack_key,item_key,name_en,name_he,sort) values
  ('air-duct','inspection','Air duct system inspection','בדיקת מערכת תעלות המיזוג',0),
  ('air-duct','whole-home','Whole-home air duct cleaning','ניקוי תעלות מיזוג לכל הבית',1),
  ('air-duct','per-vent','Additional supply or return vent','פתח אספקה או חזרה נוסף',2),
  ('air-duct','return','Return-air duct cleaning','ניקוי תעלות אוויר חוזר',3),
  ('air-duct','sanitizing','Air duct sanitizing treatment','חיטוי תעלות המיזוג',4),
  ('air-duct','deodorizing','Odor-neutralizing treatment','טיפול לנטרול ריחות',5),
  ('air-duct','mold','Suspected microbial growth treatment','טיפול בחשד להתפתחות עובש',6),
  ('air-duct','blower','Blower compartment cleaning','ניקוי תא המפוח',7),
  ('air-duct','coil','Evaporator coil cleaning','ניקוי סוללת המאייד',8),
  ('air-duct','register','Vent register cleaning','ניקוי תריסי האוורור',9),
  ('air-duct','seal','Accessible duct leak sealing','איטום דליפות נגישות בתעלות',10),
  ('air-duct','repair','Flexible duct repair','תיקון תעלה גמישה',11),
  ('air-duct','replace','Flexible duct replacement','החלפת תעלה גמישה',12),
  ('air-duct','install','New duct run installation','התקנת קו תעלה חדש',13),
  ('dryer-vent','inspection','Dryer vent safety inspection','בדיקת בטיחות לפתח המייבש',0),
  ('dryer-vent','clean','Dryer vent cleaning','ניקוי צינור המייבש',1),
  ('dryer-vent','roof','Roof-exit dryer vent cleaning','ניקוי פתח מייבש היוצא דרך הגג',2),
  ('dryer-vent','long-run','Long-run dryer vent cleaning','ניקוי קו מייבש ארוך',3),
  ('dryer-vent','bird-nest','Bird-nest removal','פינוי קן ציפורים',4),
  ('dryer-vent','lint','Heavy lint blockage removal','פינוי סתימת מוך כבדה',5),
  ('dryer-vent','disconnect','Dryer disconnect and reconnect','ניתוק וחיבור מחדש של המייבש',6),
  ('dryer-vent','transition','Transition hose replacement','החלפת צינור החיבור למייבש',7),
  ('dryer-vent','repair','Dryer vent line repair','תיקון קו האוורור של המייבש',8),
  ('dryer-vent','reroute','Dryer vent rerouting','שינוי תוואי צינור המייבש',9),
  ('dryer-vent','install','New dryer vent installation','התקנת קו מייבש חדש',10),
  ('dryer-vent','booster','Dryer booster fan service','שירות למאוורר עזר למייבש',11),
  ('dryer-vent','multi-unit','Multi-unit dryer vent cleaning','ניקוי פתחי מייבש בבניין רב-יחידות',12),
  ('dryer-vent','airflow','Before-and-after airflow test','בדיקת זרימת אוויר לפני ואחרי',13),
  ('chimney','sweep','Standard chimney sweep','ניקוי ארובה רגיל',0),
  ('chimney','inspect-1','Level 1 chimney inspection','בדיקת ארובה דרגה 1',1),
  ('chimney','inspect-2','Level 2 camera inspection','בדיקת מצלמה לארובה דרגה 2',2),
  ('chimney','creosote','Heavy creosote removal','הסרת קריאוזוט כבד',3),
  ('chimney','glaze','Glazed creosote treatment','טיפול בקריאוזוט מזוגג',4),
  ('chimney','animal','Animal or nest removal','פינוי בעל חיים או קן',5),
  ('chimney','cap-install','Chimney cap installation','התקנת כובע ארובה',6),
  ('chimney','crown-repair','Chimney crown repair','תיקון כתר הארובה',7),
  ('chimney','crown-rebuild','Chimney crown rebuild','בנייה מחדש של כתר הארובה',8),
  ('chimney','waterproof','Chimney waterproofing','איטום ארובה נגד מים',9),
  ('chimney','tuckpoint','Mortar joint tuckpointing','חידוש מישקי טיט בארובה',10),
  ('chimney','brick','Chimney brick replacement','החלפת לבנים בארובה',11),
  ('chimney','flashing','Chimney flashing repair','תיקון פח האיטום סביב הארובה',12),
  ('chimney','liner-repair','Chimney liner repair','תיקון ציפוי הארובה',13),
  ('chimney','liner-install','Stainless-steel liner installation','התקנת שרוול נירוסטה לארובה',14),
  ('chimney','firebox','Firebox repair','תיקון תא הבעירה',15),
  ('painting','consult','Color and project consultation','ייעוץ צבע ותכנון העבודה',0),
  ('painting','interior-room','Interior room painting','צביעת חדר פנימי',1),
  ('painting','interior-home','Whole-home interior painting','צביעת פנים לכל הבית',2),
  ('painting','ceiling','Ceiling painting','צביעת תקרה',3),
  ('painting','trim','Trim and baseboard painting','צביעת פאנלים וגימורים',4),
  ('painting','door','Door painting','צביעת דלת',5),
  ('painting','cabinet','Cabinet refinishing','חידוש וצביעת ארונות',6),
  ('painting','exterior','Exterior house painting','צביעת חוץ לבית',7),
  ('painting','siding','Siding painting','צביעת חיפוי חוץ',8),
  ('painting','fence','Fence or deck staining','צביעה או גיוון של גדר ודק',9),
  ('painting','pressure-wash','Pre-paint pressure washing','שטיפה בלחץ לפני צביעה',10),
  ('painting','drywall','Drywall patch and texture repair','תיקון גבס וטקסטורה',11),
  ('painting','wallpaper','Wallpaper removal','הסרת טפט',12),
  ('painting','lead','Lead-safe surface preparation','הכנת משטח בטוחה לצבע עופרת',13),
  ('masonry','inspect','Masonry condition inspection','בדיקת מצב עבודות האבן והלבנים',0),
  ('masonry','tuckpoint','Brick tuckpointing','חידוש מישקים בקיר לבנים',1),
  ('masonry','brick-repair','Brick wall repair','תיקון קיר לבנים',2),
  ('masonry','brick-replace','Individual brick replacement','החלפת לבנה בודדת',3),
  ('masonry','stone-repair','Stone veneer repair','תיקון חיפוי אבן',4),
  ('masonry','block','Concrete-block repair','תיקון בלוק בטון',5),
  ('masonry','step','Masonry step repair','תיקון מדרגות בנייה',6),
  ('masonry','walkway','Brick or stone walkway repair','תיקון שביל אבן או לבנים',7),
  ('masonry','wall','Retaining wall repair','תיקון קיר תמך',8),
  ('masonry','mailbox','Masonry mailbox repair','תיקון תיבת דואר בנויה',9),
  ('masonry','clean','Masonry cleaning','ניקוי אבן ולבנים',10),
  ('masonry','seal','Masonry water-repellent treatment','טיפול דוחה מים לאבן ולבנים',11),
  ('masonry','crack','Mortar crack repair','תיקון סדקים בטיט',12),
  ('masonry','new','Small masonry installation','עבודת בנייה קטנה חדשה',13),
  ('siding','inspect','Siding inspection','בדיקת חיפוי החוץ',0),
  ('siding','vinyl-repair','Vinyl siding repair','תיקון חיפוי ויניל',1),
  ('siding','fiber-repair','Fiber-cement siding repair','תיקון חיפוי פייבר צמנט',2),
  ('siding','wood-repair','Wood siding repair','תיקון חיפוי עץ',3),
  ('siding','panel','Siding panel replacement','החלפת לוח חיפוי',4),
  ('siding','corner','Outside-corner replacement','החלפת פינת חיפוי חיצונית',5),
  ('siding','trim','Exterior trim repair','תיקון גימור חיצוני',6),
  ('siding','soffit','Soffit repair','תיקון סופיט',7),
  ('siding','fascia','Fascia repair','תיקון פס פאשיה',8),
  ('siding','housewrap','House-wrap repair','תיקון יריעת איטום הבית',9),
  ('siding','seal','Siding joint sealing','איטום חיבורי החיפוי',10),
  ('siding','wash','Siding soft wash','שטיפה עדינה של חיפוי החוץ',11),
  ('siding','install','New siding installation','התקנת חיפוי חוץ חדש',12),
  ('siding','storm','Storm-damage siding repair','תיקון נזקי סערה בחיפוי',13),
  ('locksmith','lockout-home','Residential lockout','פריצת דלת לבית',0),
  ('locksmith','lockout-business','Commercial lockout','פריצת דלת לעסק',1),
  ('locksmith','lockout-auto','Vehicle lockout','פתיחת רכב נעול',2),
  ('locksmith','rekey','Lock rekeying','התאמת מפתח חדש למנעול',3),
  ('locksmith','lock-install','New lock installation','התקנת מנעול חדש',4),
  ('locksmith','deadbolt','Deadbolt installation','התקנת מנעול בריח',5),
  ('locksmith','smart','Smart-lock installation','התקנת מנעול חכם',6),
  ('locksmith','repair','Lock repair','תיקון מנעול',7),
  ('locksmith','key','House-key duplication','שכפול מפתח לבית',8),
  ('locksmith','master','Master-key system setup','הקמת מערכת מפתח מאסטר',9),
  ('locksmith','panic','Panic-bar service','שירות לידית בהלה',10),
  ('locksmith','closer','Door-closer service','שירות למחזר דלת',11),
  ('locksmith','safe','Safe opening consultation','ייעוץ לפתיחת כספת',12),
  ('locksmith','emergency','After-hours emergency service','שירות חירום מחוץ לשעות הפעילות',13),
  ('garage-door','inspect','Garage-door safety inspection','בדיקת בטיחות לדלת מוסך',0),
  ('garage-door','tune','Garage-door tune-up','טיפול תקופתי לדלת מוסך',1),
  ('garage-door','spring','Broken spring replacement','החלפת קפיץ שבור',2),
  ('garage-door','cable','Lift cable replacement','החלפת כבל הרמה',3),
  ('garage-door','roller','Roller replacement','החלפת גלגלים',4),
  ('garage-door','track','Track alignment or repair','יישור או תיקון מסילה',5),
  ('garage-door','panel','Door panel replacement','החלפת פנל בדלת',6),
  ('garage-door','seal','Bottom weather seal replacement','החלפת אטם תחתון',7),
  ('garage-door','opener-repair','Garage-door opener repair','תיקון מנוע לדלת מוסך',8),
  ('garage-door','opener-install','Garage-door opener installation','התקנת מנוע לדלת מוסך',9),
  ('garage-door','sensor','Safety-sensor service','שירות לחיישני בטיחות',10),
  ('garage-door','remote','Remote or keypad programming','תכנות שלט או לוח מקשים',11),
  ('garage-door','door-install','New garage-door installation','התקנת דלת מוסך חדשה',12),
  ('garage-door','emergency','Emergency stuck-door service','שירות חירום לדלת תקועה',13),
  ('hvac','diagnostic','HVAC diagnostic visit','ביקור אבחון למערכת מיזוג',0),
  ('hvac','maintenance','Seasonal HVAC maintenance','טיפול עונתי למערכת מיזוג',1),
  ('hvac','ac-repair','Air-conditioner repair','תיקון מזגן',2),
  ('hvac','heat-repair','Heating-system repair','תיקון מערכת חימום',3),
  ('hvac','no-cool','No-cooling service','טיפול במערכת שאינה מקררת',4),
  ('hvac','no-heat','No-heat service','טיפול במערכת שאינה מחממת',5),
  ('hvac','coil-clean','Condenser coil cleaning','ניקוי סוללת מעבה',6),
  ('hvac','drain','Condensate drain clearing','פתיחת ניקוז עיבוי',7),
  ('hvac','thermostat','Thermostat installation','התקנת תרמוסטט',8),
  ('hvac','refrigerant','Refrigerant leak diagnosis','אבחון דליפת גז קירור',9),
  ('hvac','indoor-air','Indoor-air-quality assessment','בדיקת איכות אוויר בתוך הבית',10),
  ('hvac','mini-split','Mini-split service','שירות למזגן מיני-ספליט',11),
  ('hvac','replace','System replacement estimate','הצעת מחיר להחלפת מערכת',12),
  ('hvac','install','New HVAC system installation','התקנת מערכת מיזוג חדשה',13),
  ('plumbing','diagnostic','Plumbing diagnostic visit','ביקור אבחון אינסטלציה',0),
  ('plumbing','leak','Water-leak repair','תיקון נזילת מים',1),
  ('plumbing','faucet','Faucet repair or replacement','תיקון או החלפת ברז',2),
  ('plumbing','toilet','Toilet repair','תיקון אסלה',3),
  ('plumbing','toilet-install','Toilet installation','התקנת אסלה',4),
  ('plumbing','drain','Drain clearing','פתיחת סתימה',5),
  ('plumbing','sewer','Main sewer-line clearing','פתיחת קו ביוב ראשי',6),
  ('plumbing','camera','Sewer camera inspection','בדיקת קו ביוב במצלמה',7),
  ('plumbing','disposal','Garbage-disposal service','שירות לטוחן אשפה',8),
  ('plumbing','heater','Water-heater repair','תיקון דוד מים',9),
  ('plumbing','heater-install','Water-heater installation','התקנת דוד מים',10),
  ('plumbing','pressure','Water-pressure diagnosis','אבחון לחץ מים',11),
  ('plumbing','repipe','Repiping consultation','ייעוץ להחלפת צנרת',12),
  ('plumbing','emergency','Emergency plumbing service','שירות אינסטלציה דחוף',13),
  ('electrical','diagnostic','Electrical diagnostic visit','ביקור אבחון חשמל',0),
  ('electrical','outlet','Outlet repair or replacement','תיקון או החלפת שקע',1),
  ('electrical','gfci','GFCI outlet installation','התקנת שקע מוגן GFCI',2),
  ('electrical','switch','Light-switch replacement','החלפת מתג תאורה',3),
  ('electrical','fixture','Light-fixture installation','התקנת גוף תאורה',4),
  ('electrical','fan','Ceiling-fan installation','התקנת מאוורר תקרה',5),
  ('electrical','breaker','Circuit-breaker replacement','החלפת מפסק בלוח',6),
  ('electrical','panel','Electrical-panel service','שירות ללוח חשמל',7),
  ('electrical','dedicated','Dedicated circuit installation','התקנת קו חשמל ייעודי',8),
  ('electrical','ev','EV charger installation','התקנת מטען לרכב חשמלי',9),
  ('electrical','surge','Whole-home surge protection','הגנת נחשולי מתח לכל הבית',10),
  ('electrical','smoke','Smoke/CO detector installation','התקנת גלאי עשן ופחמן חד-חמצני',11),
  ('electrical','rewire','Rewiring consultation','ייעוץ לחיווט מחדש',12),
  ('electrical','emergency','Emergency electrical service','שירות חשמל דחוף',13),
  ('cleaning','standard','Standard home cleaning','ניקיון בית רגיל',0),
  ('cleaning','deep','Deep cleaning','ניקיון יסודי',1),
  ('cleaning','move-in','Move-in cleaning','ניקיון לפני כניסה',2),
  ('cleaning','move-out','Move-out cleaning','ניקיון לאחר פינוי',3),
  ('cleaning','recurring','Recurring cleaning visit','ביקור ניקיון קבוע',4),
  ('cleaning','office','Office cleaning','ניקיון משרד',5),
  ('cleaning','construction','Post-construction cleaning','ניקיון לאחר שיפוץ',6),
  ('cleaning','windows','Interior window cleaning','ניקוי חלונות פנימי',7),
  ('cleaning','appliance','Appliance interior cleaning','ניקוי פנימי של מכשירי חשמל',8),
  ('cleaning','cabinet','Cabinet interior cleaning','ניקוי פנימי של ארונות',9),
  ('cleaning','carpet','Carpet spot treatment','טיפול נקודתי בשטיח',10),
  ('cleaning','odor','Odor treatment','טיפול בריחות',11),
  ('cleaning','rental','Short-term rental turnover','ניקיון בין אורחים בנכס להשכרה קצרה',12),
  ('cleaning','emergency','Same-day cleaning service','שירות ניקיון מהיום להיום',13),
  -- The neutral fallback (lib/industry-packs.ts GENERIC_SERVICES): what a
  -- business that picked no trade publishes, so its booking page is never
  -- empty and never somebody else's trade.
  ('general','service-call','Service call','קריאת שירות',0),
  ('general','estimate-visit','On-site estimate','ביקור להצעת מחיר',1),
  ('general','repair','Repair visit','ביקור תיקון',2),
  ('general','maintenance','Maintenance visit','ביקור תחזוקה',3),
  ('general','emergency','Emergency call-out','קריאת חירום',4)
on conflict (pack_key,item_key) do update set
  name_en = excluded.name_en,
  name_he = excluded.name_he,
  sort    = excluded.sort;

-- ---------------------------------------------------------------------
-- 2. A job type becomes bilingual.
--
--    `job_types.name` stays exactly as it is — it is what every existing
--    screen reads and it keeps the business's own wording in its own
--    language. `name_en` / `name_he` are the OPTIONAL explicit translations
--    the booking page needs, and `pack_item_key` records which catalogue item
--    a type came from so it can be translated later even if it is renamed.
-- ---------------------------------------------------------------------
alter table public.job_types add column if not exists name_en       text;
alter table public.job_types add column if not exists name_he       text;
alter table public.job_types add column if not exists pack_key      text;
alter table public.job_types add column if not exists pack_item_key text;
create index if not exists idx_job_types_pack_item
  on public.job_types(pack_item_key) where pack_item_key is not null;

-- ---------------------------------------------------------------------
-- 3. One resolver, used by the trigger, by the repair function and by the
--    backfill, so all three answer identically.
--
--    Order of preference for each language:
--      1. the explicit translation stored on the job type;
--      2. the catalogue row the job type is linked to;
--      3. the catalogue row whose English OR Hebrew name equals the single
--         name the job type has (this is what lets a type created before
--         this migration — or typed by hand in Settings → Job types — pick up
--         a real Hebrew name with no data migration at all);
--      4. the name itself, in whichever language it is written.
--
--    A Hebrew name that cannot be resolved comes back NULL, deliberately.
--    Storing the English name in `name_he` is precisely defect A5: it makes an
--    untranslated row indistinguishable from a translated one, and the public
--    page already falls back to `name_en` when `name_he` is null
--    (`app/book/[org]/BookingForm.tsx`), so nothing is lost by being honest.
-- ---------------------------------------------------------------------
create or replace function public.resolve_booking_service_names(
  p_name text, p_name_en text, p_name_he text, p_pack_item_key text
) returns table (resolved_en text, resolved_he text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_base       text;
  v_pack_en    text;
  v_pack_he    text;
  v_is_hebrew  boolean;
begin
  v_base := nullif(btrim(coalesce(p_name, '')), '');

  if p_pack_item_key is not null then
    select p.name_en, p.name_he into v_pack_en, v_pack_he
      from public.industry_pack_services p
     where p.pack_item_key = p_pack_item_key;
  end if;

  if v_pack_en is null and v_base is not null then
    select p.name_en, p.name_he into v_pack_en, v_pack_he
      from public.industry_pack_services p
     where p.name_en = v_base or p.name_he = v_base
     order by (p.name_en = v_base) desc, p.pack_key, p.item_key
     limit 1;
  end if;

  -- Hebrew script in the name is proof it is not the English name.
  v_is_hebrew := v_base is not null and v_base ~ E'[\u0590-\u05FF]';

  resolved_en := coalesce(
    nullif(btrim(coalesce(p_name_en, '')), ''),
    v_pack_en,
    case when v_is_hebrew then null else v_base end,
    v_base,
    'Service'
  );
  resolved_he := coalesce(
    nullif(btrim(coalesce(p_name_he, '')), ''),
    v_pack_he,
    case when v_is_hebrew then v_base else null end
  );
  return next;
end $$;

revoke all on function public.resolve_booking_service_names(text,text,text,text) from public, anon;
grant execute on function public.resolve_booking_service_names(text,text,text,text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4. The sync trigger — now bilingual, and self-correcting.
--
--    020's version wrote `name_he = new.name` (English) on INSERT and updated
--    `name_en` alone on conflict. Both halves are fixed here: the Hebrew name
--    is resolved, and the on-conflict branch maintains it.
--
--    The one thing it will NOT overwrite is a Hebrew name a human typed on
--    /settings/booking. A stored `name_he` that is null, or byte-identical to
--    the stored `name_en`, is by definition either the 020 mis-seed or an
--    untranslated row, and is replaced every time the job type is written.
--    Anything else is somebody's wording and is left alone.
-- ---------------------------------------------------------------------
create or replace function public.sync_booking_service_from_job_type()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_en text; v_he text; v_explicit boolean;
begin
  select r.resolved_en, r.resolved_he into v_en, v_he
    from public.resolve_booking_service_names(new.name, new.name_en, new.name_he, new.pack_item_key) r;
  v_explicit := nullif(btrim(coalesce(new.name_he, '')), '') is not null;

  insert into public.booking_services as bs
    (organization_id, job_type_id, name_en, name_he, duration_min, price_minor, sort)
  values
    (new.organization_id, new.id, v_en, v_he, new.duration_min, new.default_price_minor, new.sort)
  on conflict (organization_id, job_type_id) do update set
    name_en      = excluded.name_en,
    name_he      = case
                     when v_explicit then excluded.name_he
                     when bs.name_he is null or bs.name_he = bs.name_en then excluded.name_he
                     else bs.name_he
                   end,
    duration_min = excluded.duration_min,
    price_minor  = excluded.price_minor,
    sort         = excluded.sort;
  return new;
end $$;

-- `create or replace trigger` (PG14+) amends the existing trigger in place.
-- The event column list gains the three new columns so that translating a job
-- type re-syncs its booking service.
create or replace trigger trg_job_type_booking_service
after insert or update of name, name_en, name_he, pack_item_key, duration_min, default_price_minor, sort
on public.job_types
for each row execute function public.sync_booking_service_from_job_type();

-- ---------------------------------------------------------------------
-- 5. Repair, callable any number of times, by the owner, from the app.
--
--    A one-time backfill that can never run again only relocates the defect:
--    the next mis-seeded row (a job type created before its pack existed, a
--    catalogue that gains a translation next month) would be stuck for ever.
--    This is the third line of defence behind the resolver and the trigger,
--    and `app/(app)/settings/booking` exposes it as a button that reports how
--    many services it corrected.
--
--    It skips any row whose `name_he` is a real, distinct translation, so it
--    cannot undo an owner's own wording. `name_en` is only rewritten when it
--    is still the untouched machine seed (equal to the job type's own name) or
--    when it holds Hebrew script — a Hebrew business got the mirror image of
--    A5, its English column filled with Hebrew.
-- ---------------------------------------------------------------------
create or replace function public.repair_booking_service_names(p_org uuid default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_caller_org uuid; v_count integer;
begin
  v_caller_org := public.current_org_id();
  v_org := coalesce(p_org, v_caller_org);
  if v_org is null then
    raise exception 'organization_required';
  end if;
  -- A signed-in caller may only repair their own organisation, and only as
  -- owner — booking services are owner-managed (020's booking_services_owner
  -- policy). A service-role/migration caller has no current_org_id().
  if v_caller_org is not null then
    if v_org <> v_caller_org then raise exception 'forbidden'; end if;
    if public.current_user_role() <> 'owner' then raise exception 'forbidden'; end if;
  end if;

  update public.booking_services bs
     set name_en = case
                     when bs.name_en = jt.name
                       or bs.name_en = coalesce(jt.name_he, '')
                       or bs.name_en ~ E'[\u0590-\u05FF]'
                     then r.resolved_en
                     else bs.name_en
                   end,
         name_he = r.resolved_he
    from public.job_types jt
    join lateral public.resolve_booking_service_names(jt.name, jt.name_en, jt.name_he, jt.pack_item_key) r on true
   where jt.id = bs.job_type_id
     and bs.organization_id = v_org
     and (bs.name_he is null or bs.name_he = bs.name_en)
     and (bs.name_he is distinct from r.resolved_he
          or (bs.name_en = jt.name and bs.name_en is distinct from r.resolved_en)
          or (bs.name_en ~ E'[\u0590-\u05FF]' and bs.name_en is distinct from r.resolved_en));
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function public.repair_booking_service_names(uuid) from public, anon;
grant execute on function public.repair_booking_service_names(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 6. Backfill — link existing job types to the catalogue.
--
--    Nothing is renamed here: `job_types.name` is untouched. Only the
--    previously-empty translation columns are filled, which is what lets the
--    trigger and the repair function produce real Hebrew for a business that
--    onboarded before the packs were wired in. The match prefers a catalogue
--    item from a trade the business actually chose, then an English-name
--    match, and is fully ordered so it is deterministic.
-- ---------------------------------------------------------------------
update public.job_types jt
   set pack_key      = m.pack_key,
       pack_item_key = m.pack_item_key,
       name_en       = coalesce(nullif(btrim(coalesce(jt.name_en, '')), ''), m.name_en),
       name_he       = coalesce(nullif(btrim(coalesce(jt.name_he, '')), ''), m.name_he)
  from (
    select jt2.id as job_type_id, p.pack_key, p.pack_item_key, p.name_en, p.name_he
      from public.job_types jt2
      join lateral (
        select ips.*
          from public.industry_pack_services ips
         where ips.name_en = jt2.name or ips.name_he = jt2.name
         order by (exists (
                     select 1 from public.organization_industries oi
                      where oi.organization_id = jt2.organization_id
                        and oi.industry_key = ips.pack_key
                   )) desc,
                  (ips.name_en = jt2.name) desc,
                  ips.pack_key, ips.item_key
         limit 1
      ) p on true
     where jt2.pack_item_key is null
  ) m
 where m.job_type_id = jt.id;

-- ---------------------------------------------------------------------
-- 7. Seed the pack menu for a business that chose trades and has NO job
--    types at all.
--
--    `not exists (... job_types ...)` is the whole safety rule: an
--    organisation that already publishes a service list is skipped, so no
--    live booking page is rewritten by this migration. See the header.
--    The trigger from section 4 turns each inserted job type into a correct
--    bilingual booking service, so nothing inserts into booking_services here.
-- ---------------------------------------------------------------------
insert into public.job_types
  (organization_id, name, name_en, name_he, pack_key, pack_item_key, color, duration_min, default_price_minor, sort)
select oi.organization_id,
       case when o.locale = 'he' then p.name_he else p.name_en end,
       p.name_en,
       p.name_he,
       p.pack_key,
       p.pack_item_key,
       '#2b66f6',
       60,
       0,
       (row_number() over (partition by oi.organization_id order by oi.industry_key, p.sort, p.item_key) - 1)::int
  from public.organization_industries oi
  join public.organizations o on o.id = oi.organization_id
  join public.industry_pack_services p on p.pack_key = oi.industry_key
 where oi.services_imported
   and not exists (select 1 from public.job_types jt where jt.organization_id = oi.organization_id);

-- ---------------------------------------------------------------------
-- 8. Repair every organisation's Hebrew service names once, now.
--    (Section 6 already re-synced every job type it touched through the
--    trigger; this catches booking services whose job type was not matched.)
-- ---------------------------------------------------------------------
do $$
declare o record;
begin
  for o in select id from public.organizations loop
    perform public.repair_booking_service_names(o.id);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 9. Stop the hardcoded HVAC list at its source.
--
--    `db/005_more.sql:8` gave `organizations.job_types` a DEFAULT of
--    'AC Cleaning, AC Install, ...'. Nothing in the application has read that
--    text[] column since 006 turned it into rows, but the default is still
--    stamped on every organisation created, and 006's backfill turns it into
--    that HVAC menu for any organisation that exists when it runs — which is
--    exactly how a chimney sweep ended up advertising "AC Install".
--
--    The default becomes empty. Existing values are NOT rewritten (this
--    migration drops nothing and rewrites no business's data); they are simply
--    no longer a source of services for anyone new.
-- ---------------------------------------------------------------------
alter table public.organizations alter column job_types set default '{}'::text[];

-- =====================================================================
-- End migration 041.
-- =====================================================================
