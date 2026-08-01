// A PostgREST-shaped query builder over a real Postgres, INCLUDING THE ROW CAP.
//
// WHY THIS EXISTS
// ---------------
// The defect this whole data layer exists to prevent is invisible to every
// other kind of test. Supabase runs PostgREST with `db-max-rows = 1000`, so a
// `.select()` with no range returns HTTP 200, exactly 1000 rows, and
// `error === null`. Nothing on the client can tell that answer apart from a
// complete one — not the types, not the response shape, not a mock that returns
// whatever the test told it to.
//
// So a hand-written mock cannot prove a repository pages correctly: it would be
// proving that the mock counts, and the mock is written by the same person who
// wrote the bug. The only way to know is to put more than a thousand real rows
// in a real table and read them back through something that truncates the way
// the real server truncates.
//
// PGlite (tests/helpers/pg.mjs) supplies the real Postgres and the real schema.
// This supplies the truncation, and only the truncation:
//
//   * no `.range()`      -> `limit 1000`, no error, no warning. The bug.
//   * `.range(a, b)`     -> `offset a limit min(b - a + 1, 1000)`
//   * `.limit(n)`        -> `limit min(n, 1000)`
//
// WHAT THIS IS NOT. It is not PostgREST. It translates the small subset of the
// builder this codebase's repositories actually use into SQL, and it deliberately
// THROWS on anything it does not understand rather than silently ignoring it —
// an adapter that quietly dropped a `.eq()` would turn a passing test into a
// lie. Embeds, `.or()` and the rest are out of scope and say so.

/** Supabase's configured `db-max-rows`. The number this entire module is about. */
export const DB_MAX_ROWS = 1000;

function quote(value) {
  if (value === null) return "null";
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}

class Query {
  constructor(db, table, columns, options) {
    this.db = db;
    this.table = table;
    this.columns = columns;
    this.wheres = [];
    this.orders = [];
    this.limitRows = null;
    this.offsetRows = 0;
    this.headOnly = Boolean(options?.head);
    this.wantCount = options?.count === "exact";
    this.ranged = false;
  }

  eq(column, value) {
    this.wheres.push(`"${column}" = ${quote(value)}`);
    return this;
  }
  neq(column, value) {
    this.wheres.push(`"${column}" <> ${quote(value)}`);
    return this;
  }
  gte(column, value) {
    this.wheres.push(`"${column}" >= ${quote(value)}`);
    return this;
  }
  lte(column, value) {
    this.wheres.push(`"${column}" <= ${quote(value)}`);
    return this;
  }
  is(column, value) {
    this.wheres.push(`"${column}" is ${value === null ? "null" : quote(value)}`);
    return this;
  }
  in(column, values) {
    this.wheres.push(
      values.length ? `"${column}" in (${values.map(quote).join(", ")})` : "1 = 0", // PostgREST's `in.()` matches nothing, and neither does this
    );
    return this;
  }
  order(column, options) {
    this.orders.push(`"${column}" ${options?.ascending === false ? "desc" : "asc"}`);
    return this;
  }
  limit(count) {
    this.limitRows = Math.min(count, DB_MAX_ROWS);
    return this;
  }
  range(from, to) {
    this.ranged = true;
    this.offsetRows = from;
    this.limitRows = Math.min(to - from + 1, DB_MAX_ROWS);
    return this;
  }
  maybeSingle() {
    this.single = "maybe";
    return this;
  }

  sql() {
    const where = this.wheres.length ? ` where ${this.wheres.join(" and ")}` : "";
    const order = this.orders.length ? ` order by ${this.orders.join(", ")}` : "";
    // THE LINE THIS FILE EXISTS FOR. An unranged, unlimited select is capped,
    // silently, exactly as the real server caps it.
    const effective = this.limitRows === null ? DB_MAX_ROWS : this.limitRows;
    const limit = ` limit ${effective}`;
    const offset = this.offsetRows ? ` offset ${this.offsetRows}` : "";
    return `select ${this.columns} from public."${this.table}"${where}${order}${limit}${offset}`;
  }

  /** The response, as supabase-js would resolve it. */
  async execute() {
    try {
      if (this.headOnly && this.wantCount) {
        const where = this.wheres.length ? ` where ${this.wheres.join(" and ")}` : "";
        const { rows } = await this.db.query(
          `select count(*)::int as n from public."${this.table}"${where}`,
        );
        return { data: null, count: rows[0].n, error: null, status: 200 };
      }
      const { rows } = await this.db.query(this.sql());
      if (this.single) return { data: rows[0] ?? null, error: null, status: 200, count: null };
      return { data: rows, error: null, status: 200, count: null };
    } catch (error) {
      // PostgREST reports a bad query as an error OBJECT, not a rejection. A
      // fake that threw here would let a repository look error-safe while the
      // real client hands it `{ error }` and walks straight past the `if`.
      return {
        data: null,
        count: null,
        status: 400,
        error: { message: String(error.message ?? error), code: "42601", details: "", hint: "" },
      };
    }
  }

  // Thenable, and a REAL one: supabase-js's builder returns a promise from
  // `.then()`, so callers chain it. A `then` that returned undefined would work
  // under `await` and break under `.then(...)`, which is a difference the code
  // under test can see.
  then(onFulfilled, onRejected) {
    return this.execute().then(onFulfilled, onRejected);
  }
}

/**
 * A stand-in for `createClient()` that talks to a PGlite database.
 *
 * `from(table).select(columns)` only. An embed (`customers(name)`) is refused
 * loudly, because this cannot resolve one and pretending otherwise would let a
 * test claim a repository works when its query would 300 in production —
 * `tests/postgrest-embeds.test.mjs` is what covers that half.
 */
export function fakePostgrest(db) {
  return {
    from(table) {
      return {
        select(columns = "*", options) {
          if (/\(/.test(columns)) {
            throw new Error(
              `postgrest-fake cannot resolve an embed (${columns}). ` +
                `Embed correctness is guarded by tests/postgrest-embeds.test.mjs instead.`,
            );
          }
          return new Query(db, table, columns, options);
        },
      };
    },
  };
}

/**
 * A client that counts requests, so a test can assert HOW a repository read —
 * three ranged requests for 1001 rows, not one lucky big one.
 */
export function countingPostgrest(db) {
  const requests = [];
  const client = fakePostgrest(db);
  return {
    requests,
    client: {
      from(table) {
        const t = client.from(table);
        return {
          select(columns, options) {
            const q = t.select(columns, options);
            const execute = q.execute.bind(q);
            q.execute = () => {
              requests.push({ table, sql: q.sql(), ranged: q.ranged });
              return execute();
            };
            return q;
          },
        };
      },
    },
  };
}
