// =====================================================================
//  ServicePro — the migration ledger's decision logic.
//
//  WHY THIS FILE IS PURE
//  ---------------------
//  Until now, migrations were applied by a person pasting 41 files into the
//  Supabase SQL editor in filename order, and NOTHING in the database recorded
//  which of them had run. There was no way to answer "what has this environment
//  actually had applied?" except by asking someone to remember. Production is
//  already known to be running DDL from an unmerged branch while `main`
//  describes a different schema, and `db/MIGRATIONS.md` silently stopped at
//  `017_` for five migrations and ~1,370 lines of DDL.
//
//  The runner that fixes this has to make judgement calls — is this file
//  tampered with? is there a hole in the sequence? did a previous run die
//  halfway? — and every one of those calls must be provable. So all of them
//  live HERE, as pure functions over plain data: file entries in, ledger rows
//  in, a verdict out. No filesystem, no network, no database.
//
//  That is deliberate. There is no PostgreSQL, Docker or Supabase CLI on the
//  machine this was written on, so a guard that could only be exercised against
//  a live database could not be exercised at all. `tests/migration-runner.test.mjs`
//  drives every guard in this file BOTH WAYS — it fires on a planted defect and
//  stays silent on the good tree — because a guard proven only in the passing
//  direction is worth nothing.
// =====================================================================

import { createHash } from "node:crypto";

/** `042_add_widgets.sql` -> version `042`, slug `add_widgets`. */
export const MIGRATION_FILENAME = /^(\d{3})_([A-Za-z0-9_-]+)\.sql$/;

// ---------------------------------------------------------------------
// Content identity
// ---------------------------------------------------------------------

/**
 * Normalise SQL text before hashing.
 *
 * THIS IS NOT COSMETIC. The repository is developed on Windows with
 * `core.autocrlf=true` and built in CI on Linux, so the SAME COMMIT yields
 * different bytes in the two working trees. Measured, not assumed: every one of
 * the 21 files in the owner's own Supabase bundle is byte-different from the
 * branch's copy and byte-identical after this normalisation — e.g.
 * `001_schema.sql` is 29,548 bytes with LF and 30,107 bytes with CRLF, same 559
 * lines.
 *
 * A raw-byte checksum would therefore make the runner refuse to proceed on
 * every checkout that crossed a platform, with a tamper error naming a file
 * nobody had touched. A guard that cries wolf gets switched off, and then it is
 * not a guard. A false RED is the same defect as a false GREEN.
 *
 * A leading BOM is stripped for the same reason: some Windows editors add one
 * on save, which changes the bytes without changing a single SQL statement.
 */
export function normalizeSql(text) {
  return String(text).replace(/^﻿/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/** SHA-256 of the normalised content, as lowercase hex. */
export function checksumOf(text) {
  return createHash("sha256").update(normalizeSql(text), "utf8").digest("hex");
}

// ---------------------------------------------------------------------
// Classifying what is in db/
// ---------------------------------------------------------------------

/**
 * Split the `.sql` files in `db/` into migrations and declared non-migrations.
 *
 * `nonMigrations` maps filename -> reason. It holds FILENAMES, never bare
 * version numbers, and `classifyFiles` reports a declared non-migration that is
 * absent from disk. That matters: it means the gap guard below cannot be
 * silenced by adding a number to a list — silencing a gap requires putting a
 * real file there and saying, in the manifest, what it is.
 *
 * @param {string[]} filenames  every `.sql` file directly inside `db/`
 * @param {Record<string,string>} nonMigrations  filename -> why it is not a migration
 */
export function classifyFiles(filenames, nonMigrations = {}) {
  const problems = [];
  const migrations = [];
  const excluded = [];
  const seen = new Map();

  for (const filename of [...filenames].sort()) {
    if (!filename.endsWith(".sql")) continue;

    if (Object.prototype.hasOwnProperty.call(nonMigrations, filename)) {
      const m = MIGRATION_FILENAME.exec(filename);
      excluded.push({ filename, version: m ? m[1] : null, reason: nonMigrations[filename] });
      continue;
    }

    const m = MIGRATION_FILENAME.exec(filename);
    if (!m) {
      // An un-numbered .sql file is either a migration somebody forgot to
      // number, or a stray file. Both are refusals: guessing which is how a
      // 1,370-line hole opens up in the first place.
      problems.push({
        code: "unclassified_file",
        filename,
        message:
          `db/${filename} is neither a numbered migration (NNN_name.sql) nor declared in ` +
          `db/migrations.manifest.json under "nonMigrations". Number it, or declare what it is.`,
      });
      continue;
    }

    const [, version, slug] = m;
    if (seen.has(version)) {
      problems.push({
        code: "duplicate_version",
        version,
        filename,
        message:
          `two files claim migration ${version}: db/${seen.get(version)} and db/${filename}. ` +
          `Applying order would be arbitrary and the ledger could only record one of them.`,
      });
      continue;
    }
    seen.set(version, filename);
    migrations.push({ version, slug, filename });
  }

  // A migration must not claim a number a declared non-migration already holds.
  //
  // FOUND BY PLANTING IT: renaming `041_booking_locale_packs.sql` to
  // `016_booking_locale_packs.sql` produced a tree this function called
  // COHERENT. 016 was taken by the isolation test, so the new file collided
  // with it; 041 had vanished, but since the highest number was now 040 there
  // was no hole to report either. The duplicate check above only compared
  // migrations against other migrations, so a whole migration could go missing
  // in silence — the exact failure mode this file exists to prevent.
  for (const e of excluded) {
    if (e.version && seen.has(e.version)) {
      problems.push({
        code: "duplicate_version",
        version: e.version,
        filename: seen.get(e.version),
        message:
          `db/${seen.get(e.version)} claims migration ${e.version}, but db/${e.filename} already ` +
          `holds that number and is declared a non-migration. Renumber the migration — the number ` +
          `is taken, and a collision here hides both files at once.`,
      });
    }
  }

  for (const filename of Object.keys(nonMigrations)) {
    if (!filenames.includes(filename)) {
      problems.push({
        code: "declared_file_missing",
        filename,
        message:
          `db/migrations.manifest.json declares db/${filename} as a non-migration, but no such ` +
          `file exists. A declaration with no file behind it can hide a gap in the sequence.`,
      });
    }
  }

  migrations.sort((a, b) => a.version.localeCompare(b.version));
  return { migrations, excluded, problems };
}

/**
 * Every version number between the lowest and highest that has NO file at all.
 *
 * `016` is not a gap: `016_isolation_tests.sql` exists and the manifest says it
 * is a test rather than a migration. A deleted `035_*.sql` IS a gap, and cannot
 * be waved away without putting a file back.
 */
export function findGaps(migrations, excluded = []) {
  const present = new Set([
    ...migrations.map((m) => m.version),
    ...excluded.map((e) => e.version).filter(Boolean),
  ]);
  const numbers = [...present].map(Number).filter((n) => Number.isFinite(n));
  if (numbers.length === 0) return [];

  const gaps = [];
  for (let n = Math.min(...numbers); n <= Math.max(...numbers); n += 1) {
    const version = String(n).padStart(3, "0");
    if (!present.has(version)) gaps.push(version);
  }
  return gaps;
}

// ---------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------

/**
 * Decide what to do, given the files on disk and the rows in the ledger.
 *
 * @param {object} input
 * @param {{version:string, slug:string, filename:string, checksum:string}[]} input.files
 *        one entry per migration file, checksummed with `checksumOf`
 * @param {{version:string, filename:string, checksum:string, finished_at:string|null}[]} input.ledger
 *        every row of `public.schema_migrations`
 * @param {Record<string,string>} [input.nonMigrations]
 * @param {string[]} [input.allFilenames]  every `.sql` file in db/, for classification
 * @param {boolean} [input.acceptRenames]  allow a version's slug to change
 *
 * @returns {{ok:boolean, pending:object[], applied:object[], problems:object[]}}
 *          `ok` is false if ANY problem was found. Every problem is fatal:
 *          silence is what got this project here.
 */
export function planMigrations(input) {
  const {
    files = [],
    ledger = [],
    nonMigrations = {},
    allFilenames = null,
    acceptRenames = false,
  } = input;

  const problems = [];
  let migrations = files;
  let excluded = [];

  if (allFilenames) {
    const classified = classifyFiles(allFilenames, nonMigrations);
    problems.push(...classified.problems);
    excluded = classified.excluded;
    // Keep the caller's checksums; classification only decides membership.
    const byName = new Map(files.map((f) => [f.filename, f]));
    migrations = classified.migrations.map((m) => ({ ...m, ...(byName.get(m.filename) ?? {}) }));
  } else {
    const classified = classifyFiles(
      files.map((f) => f.filename),
      nonMigrations,
    );
    problems.push(...classified.problems);
    excluded = classified.excluded;
  }

  for (const version of findGaps(migrations, excluded)) {
    problems.push({
      code: "sequence_gap",
      version,
      message:
        `migration ${version} is missing entirely — no db/${version}_*.sql, and nothing declared ` +
        `for it. A hole in the sequence means some environment applied a file this checkout ` +
        `cannot even name.`,
    });
  }

  const byVersion = new Map(migrations.map((m) => [m.version, m]));
  const ledgerByVersion = new Map();
  for (const row of ledger) {
    if (ledgerByVersion.has(row.version)) {
      problems.push({
        code: "duplicate_ledger_row",
        version: row.version,
        message:
          `the ledger holds more than one row for migration ${row.version}. ` +
          `It is meant to be keyed by version; this database's ledger is corrupt.`,
      });
      continue;
    }
    ledgerByVersion.set(row.version, row);
  }

  // --- a run that died halfway ------------------------------------------
  // finished_at is written only after the file's own transaction commits, so a
  // row with a null finished_at is a migration that started and never reported
  // back: the connection dropped, the SQL editor tab was closed, the statement
  // was cancelled. Nobody can tell from here how much of it landed, and
  // guessing means either skipping DDL or re-running a file mid-way through.
  for (const row of ledger) {
    if (row.finished_at === null || row.finished_at === undefined) {
      problems.push({
        code: "partially_applied",
        version: row.version,
        message:
          `migration ${row.version} (${row.filename}) was started at ${row.started_at ?? "an unknown time"} ` +
          `and never finished. The database is in an unknown state: some of that file may have ` +
          `been applied. Inspect it, finish or undo it by hand, then resolve the ledger row.`,
      });
    }
  }

  const applied = [];
  for (const row of ledger) {
    const file = byVersion.get(row.version);

    // --- a migration this checkout does not have --------------------------
    // Exactly the production situation: the live database is running DDL from
    // an unmerged branch. Deploying this checkout on top would apply a
    // different history than the one that is actually there.
    if (!file) {
      problems.push({
        code: "applied_file_missing",
        version: row.version,
        message:
          `the ledger says migration ${row.version} (${row.filename}) was applied to this database, ` +
          `but no such file exists in this checkout. This environment was migrated from a ` +
          `different branch or revision than the one you are deploying.`,
      });
      continue;
    }

    // --- the file changed after it ran ------------------------------------
    if (file.checksum && row.checksum && file.checksum !== row.checksum) {
      problems.push({
        code: "checksum_mismatch",
        version: row.version,
        filename: file.filename,
        message:
          `db/${file.filename} has changed since it was applied. Ledger recorded ` +
          `${String(row.checksum).slice(0, 12)}…, the file on disk is ${file.checksum.slice(0, 12)}…. ` +
          `The database was built from SQL that no longer exists. Applied migrations are ` +
          `immutable — write a new one instead of editing this.`,
      });
    }

    // --- the file was renamed ---------------------------------------------
    // Not fatal in itself (identity is the version, not the filename — see
    // db/MIGRATIONS.md), but it must never be silent: an operator reading the
    // ledger would otherwise see a filename that no longer exists.
    if (row.filename && row.filename !== file.filename && !acceptRenames) {
      problems.push({
        code: "renamed_migration",
        version: row.version,
        filename: file.filename,
        message:
          `migration ${row.version} was applied as "${row.filename}" and is now "${file.filename}". ` +
          `The content is unchanged, so this is a rename, not a re-run. Re-run with ` +
          `--accept-renames to record the new name in the ledger.`,
      });
    }

    applied.push({ ...file, row });
  }

  const pending = migrations.filter((m) => !ledgerByVersion.has(m.version));

  // --- a migration inserted behind the high-water mark --------------------
  // Someone branched at 035, wrote 036, and merged after 041 had already been
  // applied. Applying it now runs it against a schema five migrations newer
  // than the one it was written and reviewed against.
  const appliedVersions = ledger.map((r) => r.version).sort();
  const highWater = appliedVersions.length ? appliedVersions[appliedVersions.length - 1] : null;
  if (highWater) {
    for (const m of pending) {
      if (m.version < highWater) {
        problems.push({
          code: "out_of_order",
          version: m.version,
          filename: m.filename,
          message:
            `db/${m.filename} has never been applied, but migration ${highWater} already has. ` +
            `Applying ${m.version} now would run it against a schema newer than the one it was ` +
            `written against. Renumber it above ${highWater} after checking it is still correct.`,
        });
      }
    }
  }

  pending.sort((a, b) => a.version.localeCompare(b.version));
  applied.sort((a, b) => a.version.localeCompare(b.version));
  problems.sort((a, b) => String(a.version ?? "").localeCompare(String(b.version ?? "")));

  return { ok: problems.length === 0, pending, applied, problems };
}

// ---------------------------------------------------------------------
// The SQL the runner writes to the ledger.
//
// These live here, beside the decision logic, so that the database tests in
// tests/migration-ledger-db.test.mjs exercise THE SQL THE RUNNER ACTUALLY
// EMITS. A test that writes its own hand-rolled INSERT proves that Postgres
// accepts that INSERT, which is not the claim anybody cares about.
// ---------------------------------------------------------------------

/** Single-quote a SQL literal, or `null`. */
export function sqlQuote(value) {
  return value === null || value === undefined ? "null" : `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * Record that a migration is ABOUT to run. Committed on its own, before the
 * file executes — see the comment in scripts/db-migrate.mjs for why the two
 * phases must not share a transaction.
 */
export function recordStartSql(migration, appliedBy) {
  return (
    "insert into public.schema_migrations (version, name, filename, checksum, applied_by, origin) values (" +
    [migration.version, migration.slug, migration.filename, migration.checksum, appliedBy]
      .map(sqlQuote)
      .join(", ") +
    ", 'applied');"
  );
}

/** Mark a migration finished. Until this runs, the row reads as partially applied. */
export function recordFinishSql(version) {
  return `update public.schema_migrations set finished_at = now() where version = ${sqlQuote(version)};`;
}

/**
 * Record migrations as already applied WITHOUT executing them — how an existing
 * database (production) comes under the ledger.
 */
export function recordAdoptedSql(migrations, appliedBy, note) {
  const values = migrations
    .map(
      (m) =>
        "(" +
        [m.version, m.slug, m.filename, m.checksum].map(sqlQuote).join(", ") +
        `, now(), now(), ${sqlQuote(appliedBy)}, 'adopted', ${sqlQuote(note)})`,
    )
    .join(",\n    ");
  return (
    "insert into public.schema_migrations " +
    "(version, name, filename, checksum, started_at, finished_at, applied_by, origin, note) values\n    " +
    `${values}\n  on conflict (version) do nothing;`
  );
}

/** Read the whole ledger as a single JSON value. */
export const LEDGER_READ_SQL =
  "select coalesce(json_agg(row_to_json(t) order by t.version), '[]'::json) as ledger from (" +
  "select version, name, filename, checksum, started_at, finished_at, applied_by, origin, note " +
  "from public.schema_migrations) t";

// ---------------------------------------------------------------------
// db/MIGRATIONS.md — generated, never hand-maintained
// ---------------------------------------------------------------------

export const DOC_BEGIN = "<!-- BEGIN GENERATED SEQUENCE -->";
export const DOC_END = "<!-- END GENERATED SEQUENCE -->";

/**
 * Render the ordered sequence table for db/MIGRATIONS.md.
 *
 * The doc used to be a hand-kept list, and it drifted: it stopped at `017_` and
 * omitted 018-022 entirely, which as a disaster-recovery runbook would have
 * rebuilt a database the application cannot run against. This function derives
 * the table from the files that are actually on disk, so the list cannot stop
 * early. Descriptions come from the manifest, and a migration with no
 * description renders a marker that `tests/migrations-doc.test.mjs` fails on —
 * so a new migration cannot be merged undocumented.
 */
export function renderSequenceTable({ migrations, excluded = [], descriptions = {} }) {
  const lines = [
    DOC_BEGIN,
    "",
    `<!-- Generated by \`npm run db:docs\`. Do not edit between these markers; edit`,
    `     db/migrations.manifest.json instead. tests/migrations-doc.test.mjs fails if`,
    `     this table and the files in db/ ever disagree. -->`,
    "",
    `**${migrations.length} migrations**, applied in this order.`,
    "",
    "| Order | Version | File | What it adds |",
    "|---|---|---|---|",
  ];

  migrations.forEach((m, i) => {
    const desc =
      descriptions[m.version] ?? "**MISSING — add a description to db/migrations.manifest.json**";
    lines.push(`| ${i + 1} | \`${m.version}\` | \`${m.filename}\` | ${desc} |`);
  });

  if (excluded.length) {
    lines.push(
      "",
      "### `.sql` files in `db/` that are NOT migrations",
      "",
      "| File | Why |",
      "|---|---|",
    );
    for (const e of [...excluded].sort((a, b) => a.filename.localeCompare(b.filename))) {
      lines.push(`| \`${e.filename}\` | ${e.reason} |`);
    }
  }

  lines.push("", DOC_END);
  return lines.join("\n");
}

/** Replace the generated block in an existing document. */
export function spliceGeneratedBlock(doc, block) {
  const start = doc.indexOf(DOC_BEGIN);
  const end = doc.indexOf(DOC_END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(
      `db/MIGRATIONS.md is missing its ${DOC_BEGIN} / ${DOC_END} markers — cannot regenerate safely.`,
    );
  }
  return doc.slice(0, start) + block + doc.slice(end + DOC_END.length);
}
