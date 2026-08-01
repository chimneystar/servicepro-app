#!/usr/bin/env node
// =====================================================================
//  ServicePro — derive lib/supabase/database.types.ts from the migrations.
//
//    npm run db:types             — rebuild the type file
//    npm run db:types -- --check  — fail if it is stale (run by npm test)
//
//  WHY
//  ---
//  Every read from the database used to come back as `any`. That is not a
//  style problem. `supabase.from("merchant_accounts")` type-checked perfectly
//  while naming a table that HAS NEVER EXISTED — the audit found it in
//  production code. Renaming a column in a migration could not break the
//  build, so nothing told you which screens you had just broken.
//
//  The obvious fix — hand-write the types — replaces one unchecked claim with
//  another, because a hand-written type is a transcription of the schema and
//  transcriptions drift. `db/schema.sql` proved that: it was read for years as
//  "the schema" while being wrong by ~1,370 lines of DDL.
//
//  So the types are DERIVED, by the same route as db/schema.generated.txt:
//  apply every migration to an empty PostgreSQL (PGlite — real Postgres, no
//  Docker), then read the catalogue and write down what is actually there.
//  `tests/db-types.test.mjs` rebuilds it and fails when the committed file and
//  the migrations disagree, so a migration that renames a column cannot land
//  without either the type file changing in the same review or the build going
//  red.
//
//  WHAT IT IS NOT. It is not the Supabase CLI's `gen types`, which needs a
//  linked cloud project and therefore cannot run in CI here; the output shape
//  is deliberately the same (`Database["public"]["Tables"][T]["Row"]`) so the
//  CLI could replace this file without touching a call site. It does not know
//  about PostgREST's own coercions beyond the mapping in `tsTypeFor` below,
//  and it cannot type a `select()` string that the migrations do not explain.
// =====================================================================

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import prettier from "prettier";
import { freshDatabase } from "../tests/helpers/pg.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const TYPES_PATH = join(ROOT, "lib", "supabase", "database.types.ts");

// ---------------------------------------------------------------------
//  Postgres type -> TypeScript type.
//
//  The mapping is what PostgREST puts on the wire as JSON, not what the
//  column is in the database. `int8` is a 64-bit integer that PostgREST
//  serialises as a JSON number, so it is `number` here even though that
//  loses precision above 2^53 — the alternative (`string`) would be a lie
//  about what arrives in the browser. Money in this codebase is `*_minor`
//  int8 in cents, so the honest ceiling is ~90 trillion dollars.
//
//  `numeric` is also `number`: PostgREST emits it unquoted. The two numeric
//  columns in this schema are numeric(12,3) quantities, well inside range.
//
//  Everything date-like is `string` because JSON has no date type; the
//  client receives an ISO-8601 string and `lib/format.ts` parses it.
// ---------------------------------------------------------------------
const SCALARS = {
  bool: "boolean",
  int2: "number",
  int4: "number",
  int8: "number",
  float4: "number",
  float8: "number",
  numeric: "number",
  money: "string",
  text: "string",
  varchar: "string",
  bpchar: "string",
  char: "string",
  name: "string",
  citext: "string",
  uuid: "string",
  date: "string",
  time: "string",
  timetz: "string",
  timestamp: "string",
  timestamptz: "string",
  interval: "string",
  inet: "string",
  cidr: "string",
  macaddr: "string",
  bytea: "string",
  tsrange: "string",
  tstzrange: "string",
  daterange: "string",
  int4range: "string",
  int8range: "string",
  numrange: "string",
  json: "Json",
  jsonb: "Json",
  void: "undefined",
  record: "Json",
  vector: "number[]",
};

/** A TS identifier, or a quoted key when the name is not one. */
const key = (name) => (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name));

/**
 * The catalogue rows this generator needs, read once from a fresh database.
 *
 * Extension-owned objects are excluded throughout. `create extension pgcrypto`
 * puts 37 functions into `public`, including three `pgp_pub_decrypt`
 * overloads; typing them would be noise and would collide on name.
 */
async function readCatalogue(db) {
  const q = async (sql) => (await db.query(sql)).rows;

  // Every type reachable from a column or a function, resolved to a name, a
  // kind ('b' base / 'e' enum / 'd' domain / 'c' composite / 'p' pseudo) and
  // — for arrays — its element type. Resolving via OID rather than
  // format_type() means `text[]`, `_text` and a domain over text all land in
  // the same place.
  const types = await q(`
    select t.oid::int as oid, t.typname as name, t.typtype as kind,
           t.typcategory as category, t.typelem::int as elem, t.typbasetype::int as basetype,
           n.nspname as schema
      from pg_type t join pg_namespace n on n.oid = t.typnamespace
  `);

  const enums = await q(`
    select t.typname as name,
           array_agg(e.enumlabel order by e.enumsortorder) as labels
      from pg_type t
      join pg_enum e on e.enumtypid = t.oid
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public'
     group by t.typname
     order by t.typname
  `);

  const columns = await q(`
    select c.relname as tbl, c.relkind as relkind, a.attname as col, a.atttypid::int as typid,
           a.attnotnull as notnull, a.attidentity as identity, a.attgenerated as generated,
           (d.adbin is not null) as has_default
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
     where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
     order by c.relname, a.attnum
  `);

  // Foreign keys become PostgREST's embedded-resource graph. Without these,
  // `select("id, customers(name)")` cannot be typed at all: postgrest-js
  // resolves an embed by looking for a relationship, and there are 25 such
  // selects in this codebase.
  const foreignKeys = await q(`
    select con.conname as name,
           src.relname as tbl,
           tgt.relname as referenced_relation,
           (select array_agg(sa.attname order by k.ord)
              from unnest(con.conkey) with ordinality as k(attnum, ord)
              join pg_attribute sa on sa.attrelid = con.conrelid and sa.attnum = k.attnum
           ) as columns,
           (select array_agg(ta.attname order by k.ord)
              from unnest(con.confkey) with ordinality as k(attnum, ord)
              join pg_attribute ta on ta.attrelid = con.confrelid and ta.attnum = k.attnum
           ) as referenced_columns,
           exists (
             select 1 from pg_constraint u
              where u.conrelid = con.conrelid
                and u.contype in ('p', 'u')
                and u.conkey::int[] @> con.conkey::int[]
                and con.conkey::int[] @> u.conkey::int[]
           ) as one_to_one
      from pg_constraint con
      join pg_class src on src.oid = con.conrelid
      join pg_class tgt on tgt.oid = con.confrelid
      join pg_namespace n on n.oid = src.relnamespace
     where n.nspname = 'public' and con.contype = 'f'
     order by src.relname, con.conname
  `);

  // Single-column CHECK constraints that enumerate their values.
  //
  // Six columns in this schema use a real Postgres enum type. NINETY-NINE more
  // are `text` with `check (col = any (array['a','b','c']))` — the same
  // meaning, expressed the other way, and invisible to a generator that only
  // reads `pg_enum`. That is most of the status columns in the product:
  // `automation_runs.status`, `call_events.direction`, `payments.method`,
  // `documents.kind`. Reading them turns `status: "payed"` from a row the
  // database rejects at runtime into a compile error.
  const checks = await q(`
    select c.relname as tbl,
           (select a.attname
              from pg_attribute a
             where a.attrelid = con.conrelid and a.attnum = con.conkey[1]) as col,
           pg_get_constraintdef(con.oid) as def
      from pg_constraint con
      join pg_class c on c.oid = con.conrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and con.contype = 'c'
       and array_length(con.conkey, 1) = 1
     order by c.relname, con.conname
  `);

  // BEFORE INSERT triggers, with the body of the function they call.
  //
  // A NOT NULL column with no DEFAULT looks required, and usually is. It is
  // not required when a BEFORE INSERT trigger fills it: `payments.provider`,
  // `payments.normalized_status` and `payments.base_amount_minor` are all
  // `not null` with the default explicitly dropped, and
  // `prepare_payment_row()` derives each one when the row arrives without it.
  // Four INSERT sites — the Stripe webhook among them — rely on exactly that.
  //
  // Treating those columns as required would not be strictness, it would be
  // wrong: it would demand values the database is deliberately deriving, and
  // hand-copying a derivation into four call sites is how the derivation and
  // the copies drift. Supabase's own generator reads only `column_default`
  // and gets this wrong.
  const beforeInsertTriggers = await q(`
    select c.relname as tbl, p.prosrc as body
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_proc p on p.oid = t.tgfoid
     where n.nspname = 'public'
       and not t.tgisinternal
       and (t.tgtype & 2) <> 0   -- BEFORE
       and (t.tgtype & 4) <> 0   -- INSERT
     order by c.relname, t.tgname
  `);

  // Functions PostgREST can call: ours, in public, not returning `trigger`,
  // and not owned by an extension.
  const functions = await q(`
    select p.proname as name,
           p.prorettype::int as rettype,
           p.proretset as returns_set,
           p.pronargs as nargs,
           p.pronargdefaults as ndefaults,
           coalesce(p.proallargtypes::int[], p.proargtypes::int[]) as argtypes,
           p.proargmodes::text[] as argmodes,
           p.proargnames::text[] as argnames,
           pg_get_function_identity_arguments(p.oid) as identity_args
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      join pg_type rt on rt.oid = p.prorettype
     where n.nspname = 'public'
       and rt.typname <> 'trigger'
       and not exists (
         select 1 from pg_depend d
          where d.objid = p.oid and d.deptype = 'e'
       )
     order by p.proname, pg_get_function_identity_arguments(p.oid)
  `);

  return { types, enums, columns, foreignKeys, functions, checks, beforeInsertTriggers };
}

/**
 * Columns a PL/pgSQL trigger body assigns to, i.e. `new.foo := ...`.
 *
 * Deliberately narrow: only a direct assignment to a NEW field counts.
 * `new := something` (whole-row) and dynamic SQL are not detected and must
 * not be, because a column this function names becomes OPTIONAL in Insert —
 * claiming a column is supplied when it is not would turn a compile-time
 * check into a runtime not-null violation, which is the direction that hurts.
 */
export function columnsAssignedByTrigger(body) {
  const found = new Set();
  const pattern = /\bnew\s*\.\s*(?:"([^"]+)"|([a-z_][a-z0-9_$]*))\s*(?::=|=(?!=))/gi;
  for (const m of body.matchAll(pattern)) found.add(m[1] ?? m[2].toLowerCase());
  return found;
}

/**
 * The literal values a single-column CHECK constraint allows, or null.
 *
 * DELIBERATELY STRICT. It matches only the exact shape Postgres prints for
 * `check (col = any (array[...]))` over literal constants — nothing else. A
 * looser parser would be actively dangerous here: `check (status = any(...)
 * or status is null)` allows a value this function must not claim is
 * impossible, and a type that forbids a value the database accepts breaks
 * working code. When in doubt it returns null and the column stays `string`.
 *
 * Both spellings are handled: `(col = ANY (ARRAY['a'::text]))` for text and
 * `((col)::text = ANY ((ARRAY['a'::character varying])::text[]))` for varchar.
 */
export function checkEnumValues(def, column) {
  const body = /^CHECK \(\((.*)\)\)$/s.exec(def)?.[1];
  if (!body) return null;

  const col = column.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const shape = new RegExp(
    `^(?:\\(${col}\\)::text|${col}) = ANY \\(\\(?ARRAY\\[(.*?)\\]` +
      `(?:::(?:character varying|text)\\[\\])?\\)?\\)$`,
    "s",
  );
  const list = shape.exec(body)?.[1];
  if (list === undefined) return null;

  // Split on commas that are not inside a quoted literal, then require every
  // element to be a bare constant. An expression, a function call or a column
  // reference means this is not an enumeration and we give up.
  const parts = list.split(/,(?=(?:[^']*'[^']*')*[^']*$)/).map((s) => s.trim());
  const values = [];
  for (const part of parts) {
    const stripped = part.replace(/::[a-z ]+(\[\])?$/i, "").trim();
    if (/^'(?:[^']|'')*'$/.test(stripped)) {
      values.push({ literal: stripped.slice(1, -1).replace(/''/g, "'") });
    } else if (/^-?\d+$/.test(stripped)) {
      values.push({ number: Number(stripped) });
    } else {
      return null;
    }
  }
  return values.length ? values : null;
}

/** Build a resolver from type OID to a TypeScript type expression. */
function typeResolver(types) {
  const byOid = new Map(types.map((t) => [t.oid, t]));
  const publicEnums = new Set(
    types.filter((t) => t.kind === "e" && t.schema === "public").map((t) => t.name),
  );

  /**
   * `unknown`, deliberately, for anything unmapped.
   *
   * The tempting default is `any`, which would make an unmapped type silently
   * assignable to everything — exactly the hole this whole file exists to
   * close. `unknown` makes a new Postgres type show up as a compile error at
   * the first call site that uses it, which is where someone can decide what
   * it should be. There are none today.
   */
  function tsTypeFor(oid, seen = 0) {
    const t = byOid.get(oid);
    if (!t || seen > 4) return "unknown";
    if (t.kind === "d") return tsTypeFor(t.basetype, seen + 1); // domain
    if (t.kind === "e") {
      return publicEnums.has(t.name)
        ? `Database["public"]["Enums"][${JSON.stringify(t.name)}]`
        : "string";
    }
    if (t.category === "A" && t.elem) {
      const inner = tsTypeFor(t.elem, seen + 1);
      return `${inner}[]`;
    }
    return SCALARS[t.name] ?? "unknown";
  }

  return tsTypeFor;
}

/** Build the whole type file as source text. */
export async function buildTypes() {
  const { db, applied } = await freshDatabase();
  const cat = await readCatalogue(db);
  const tsTypeFor = typeResolver(cat.types);

  const relByTable = new Map();
  for (const fk of cat.foreignKeys) {
    if (!relByTable.has(fk.tbl)) relByTable.set(fk.tbl, []);
    relByTable.get(fk.tbl).push(fk);
  }

  const colsByTable = new Map();
  for (const c of cat.columns) {
    if (!colsByTable.has(c.tbl)) colsByTable.set(c.tbl, []);
    colsByTable.get(c.tbl).push(c);
  }

  // table -> column -> TS union derived from a CHECK constraint. Where a
  // column carries more than one enumerating CHECK (none do today, but a
  // migration could add one) the narrowest wins, since the database requires
  // both.
  const checkUnions = new Map();
  let checkColumns = 0;
  for (const c of cat.checks) {
    if (!c.col) continue;
    const values = checkEnumValues(c.def, c.col);
    if (!values) continue;
    const union = values
      .map((v) => ("literal" in v ? JSON.stringify(v.literal) : String(v.number)))
      .join(" | ");
    if (!checkUnions.has(c.tbl)) checkUnions.set(c.tbl, new Map());
    const existing = checkUnions.get(c.tbl).get(c.col);
    if (existing === undefined) checkColumns += 1;
    if (existing === undefined || union.length < existing.length) {
      checkUnions.get(c.tbl).set(c.col, union);
    }
  }

  // table -> set of columns a BEFORE INSERT trigger supplies.
  const triggerFilled = new Map();
  let triggerFilledColumns = 0;
  for (const t of cat.beforeInsertTriggers) {
    if (!triggerFilled.has(t.tbl)) triggerFilled.set(t.tbl, new Set());
    for (const col of columnsAssignedByTrigger(t.body)) triggerFilled.get(t.tbl).add(col);
  }
  for (const [tbl, cols] of triggerFilled) {
    for (const c of colsByTable.get(tbl) ?? []) {
      if (cols.has(c.col) && c.notnull && !c.has_default && c.generated !== "s") {
        triggerFilledColumns += 1;
      }
    }
  }

  const isView = (relkind) => relkind === "v" || relkind === "m";
  const tableNames = [...colsByTable.keys()]
    .filter((t) => !isView(colsByTable.get(t)[0].relkind))
    .sort();
  const viewNames = [...colsByTable.keys()]
    .filter((t) => isView(colsByTable.get(t)[0].relkind))
    .sort();

  const out = [];
  out.push(
    "// =====================================================================",
    "//  GENERATED FILE - DO NOT EDIT.",
    "//",
    "//  The database as the migrations in db/ actually build it. Produced by",
    "//  applying every migration to an empty PostgreSQL and reading the",
    "//  catalogue: `npm run db:types`. `tests/db-types.test.mjs` fails when this",
    "//  file and the migrations disagree.",
    "//",
    `//  migrations applied: ${applied.length}`,
    `//  tables: ${tableNames.length}   enums: ${cat.enums.length}   ` +
      `foreign keys: ${cat.foreignKeys.length}   functions: ${cat.functions.length}`,
    `//  columns narrowed to a union by a CHECK constraint: ${checkColumns}`,
    `//  NOT NULL columns a BEFORE INSERT trigger supplies: ${triggerFilledColumns}`,
    "// =====================================================================",
    "",
    "export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];",
    "",
    "export type Database = {",
    "  public: {",
    "    Tables: {",
  );

  const emitColumns = (cols, mode, tbl) => {
    const lines = [];
    for (const c of cols) {
      const ts = checkUnions.get(tbl)?.get(c.col) ?? tsTypeFor(c.typid);
      const nullable = !c.notnull;
      if (mode === "Row") {
        lines.push(`${key(c.col)}: ${ts}${nullable ? " | null" : ""};`);
        continue;
      }
      // A STORED GENERATED column cannot be written. `never` is not
      // pedantry: `total_minor` is generated in more than one table here,
      // and an INSERT that names it fails at the database. Making it
      // unwritable in the type moves that failure to compile time.
      if (c.generated === "s") {
        lines.push(`${key(c.col)}?: never;`);
        continue;
      }
      const optional =
        mode === "Update" ||
        nullable ||
        c.has_default ||
        c.identity !== "" ||
        (triggerFilled.get(tbl)?.has(c.col) ?? false);
      lines.push(`${key(c.col)}${optional ? "?" : ""}: ${ts}${nullable ? " | null" : ""};`);
    }
    return lines;
  };

  const emitRelationships = (tbl) => {
    const fks = relByTable.get(tbl) ?? [];
    if (!fks.length) return ["Relationships: [];"];
    const lines = ["Relationships: ["];
    for (const fk of fks) {
      lines.push(
        "{",
        `foreignKeyName: ${JSON.stringify(fk.name)};`,
        `columns: [${fk.columns.map((c) => JSON.stringify(c)).join(", ")}];`,
        `isOneToOne: ${fk.one_to_one ? "true" : "false"};`,
        `referencedRelation: ${JSON.stringify(fk.referenced_relation)};`,
        `referencedColumns: [${fk.referenced_columns.map((c) => JSON.stringify(c)).join(", ")}];`,
        "},",
      );
    }
    lines.push("];");
    return lines;
  };

  for (const tbl of tableNames) {
    const cols = colsByTable.get(tbl);
    out.push(`${key(tbl)}: {`);
    out.push("Row: {", ...emitColumns(cols, "Row", tbl), "};");
    out.push("Insert: {", ...emitColumns(cols, "Insert", tbl), "};");
    out.push("Update: {", ...emitColumns(cols, "Update", tbl), "};");
    out.push(...emitRelationships(tbl));
    out.push("};");
  }
  out.push("};", "Views: {");
  for (const v of viewNames) {
    const cols = colsByTable.get(v);
    out.push(`${key(v)}: {`);
    out.push("Row: {", ...emitColumns(cols, "Row", v), "};");
    out.push(...emitRelationships(v));
    out.push("};");
  }
  out.push("};", "Functions: {");

  // Overloads share one key. `accept_invitation` genuinely has two
  // signatures here — `()` from migration 023 and `(invite_token text)` from
  // 034, which is the one that requires the token — so Args becomes a union
  // and the caller has to pick a shape that exists.
  const byName = new Map();
  for (const f of cat.functions) {
    if (!byName.has(f.name)) byName.set(f.name, []);
    byName.get(f.name).push(f);
  }
  for (const [name, overloads] of [...byName.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const argShapes = [];
    const returnShapes = [];
    for (const f of overloads) {
      const modes = f.argmodes ?? null;
      const argtypes = f.argtypes ?? [];
      const argnames = f.argnames ?? [];
      const inArgs = [];
      const outArgs = [];
      argtypes.forEach((oid, i) => {
        const mode = modes ? modes[i] : "i";
        const argName = argnames[i] ?? `arg${i}`;
        if (mode === "i" || mode === "b" || mode === "v") inArgs.push({ argName, oid, i });
        if (mode === "o" || mode === "b" || mode === "t") outArgs.push({ argName, oid });
      });
      // Arguments with a DEFAULT are optional; Postgres puts the defaulted
      // ones last. Marking them optional is what lets
      // `rpc("login_throttle_counts", { p_email })` compile — it is a real
      // call site, and the CLI's generator gets this wrong.
      const firstOptional = inArgs.length - (f.ndefaults ?? 0);
      argShapes.push(
        inArgs.length === 0
          ? "Record<PropertyKey, never>"
          : `{ ${inArgs
              .map(
                (a, idx) =>
                  `${key(a.argName)}${idx >= firstOptional ? "?" : ""}: ${tsTypeFor(a.oid)}`,
              )
              .join("; ")} }`,
      );

      let ret;
      if (outArgs.length > 0) {
        ret = `{ ${outArgs.map((a) => `${key(a.argName)}: ${tsTypeFor(a.oid)}`).join("; ")} }`;
      } else {
        ret = tsTypeFor(f.rettype);
      }
      returnShapes.push(f.returns_set ? `${ret}[]` : ret);
    }
    const uniq = (xs) => [...new Set(xs)];
    out.push(`${key(name)}: {`);
    out.push(`Args: ${uniq(argShapes).join(" | ")};`);
    out.push(`Returns: ${uniq(returnShapes).join(" | ")};`);
    out.push("};");
  }

  out.push("};", "Enums: {");
  for (const e of cat.enums) {
    out.push(`${key(e.name)}: ${e.labels.map((l) => JSON.stringify(l)).join(" | ")};`);
  }
  out.push("};", "CompositeTypes: {");
  out.push("[_ in never]: never;");
  out.push("};", "};", "};", "");

  // --- convenience aliases, so call sites do not spell the path out --------
  out.push(
    "/** A row as it comes back from a plain `select()` — e.g. `Tables<\"invoices\">`. */",
    'export type Tables<T extends keyof Database["public"]["Tables"]> =',
    '  Database["public"]["Tables"][T]["Row"];',
    "",
    "/** The shape `insert()` accepts: defaults and nullables optional, generated columns forbidden. */",
    'export type TablesInsert<T extends keyof Database["public"]["Tables"]> =',
    '  Database["public"]["Tables"][T]["Insert"];',
    "",
    "/** The shape `update()` accepts — every column optional. */",
    'export type TablesUpdate<T extends keyof Database["public"]["Tables"]> =',
    '  Database["public"]["Tables"][T]["Update"];',
    "",
    '/** A Postgres enum, e.g. `Enums<"invoice_status">` is `"unpaid" | "paid" | "void"`. */',
    'export type Enums<T extends keyof Database["public"]["Enums"]> =',
    '  Database["public"]["Enums"][T];',
    "",
  );

  const source = out.join("\n");
  return prettier.format(source, {
    ...(await prettier.resolveConfig(TYPES_PATH)),
    filepath: TYPES_PATH,
    endOfLine: "lf",
  });
}

// Only act when run directly, so the test can import buildTypes().
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const types = await buildTypes();
  if (process.argv.includes("--check")) {
    if (!existsSync(TYPES_PATH)) {
      console.error("lib/supabase/database.types.ts is missing. Run `npm run db:types`.");
      process.exit(1);
    }
    if (readFileSync(TYPES_PATH, "utf8").replace(/\r\n/g, "\n") !== types) {
      console.error(
        "lib/supabase/database.types.ts does not match what the migrations produce.\n" +
          "A migration changed the schema without the types being regenerated.\n" +
          "Run `npm run db:types` and review the diff.",
      );
      process.exit(1);
    }
    console.log("lib/supabase/database.types.ts matches the migrations.");
  } else {
    writeFileSync(TYPES_PATH, types);
    console.log(`wrote lib/supabase/database.types.ts (${types.split("\n").length} lines)`);
  }
  process.exit(0);
}
