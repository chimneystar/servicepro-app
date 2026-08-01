// Split a .sql script into individual statements.
//
// WHY THIS EXISTS
// ---------------
// db/ci/*.sql is ~85 adversarial security assertions. Handed to the server as
// one blob they behave like `psql -v ON_ERROR_STOP=1`: the FIRST failure aborts
// the script and every assertion after it is never evaluated. For a suite whose
// entire job is to tell you which policies are wrong, "you have at least one
// problem" is close to useless — you want the whole list on the first run.
//
// So the runner feeds the server one statement at a time, wraps each assertion
// in a SAVEPOINT, and on failure rolls back to it and carries on. That turns the
// file into ~85 independently reported checks instead of one all-or-nothing run.
//
// Splitting SQL on ";" naively would corrupt the assertions, because the payload
// of almost every one of them is a dollar-quoted string containing its own
// semicolons:
//
//     select ci.assert(ci.attempt($q$update public.profiles set role='owner'
//                                 where id = '...'$q$) <= 0, '...');
//
// This tokeniser therefore tracks the four things that can contain a ";" and
// must not be split inside: line comments, block comments, single-quoted
// literals (with '' escapes), double-quoted identifiers, and dollar-quoted
// strings of any tag. It is deliberately not a full SQL parser — it only needs
// to know where a statement ends.

/**
 * @param {string} sql
 * @returns {{ text: string, line: number }[]} statements, comments preserved,
 *   each with the 1-based line the statement started on so a failure can be
 *   pointed at the source.
 */
export function splitStatements(sql) {
  const out = [];
  let buf = "";
  let line = 1;
  let startLine = 1;

  for (let i = 0; i < sql.length;) {
    const two = sql.slice(i, i + 2);

    // -- line comment
    if (two === "--") {
      const end = sql.indexOf("\n", i);
      const stop = end === -1 ? sql.length : end;
      buf += sql.slice(i, stop);
      i = stop;
      continue;
    }

    // /* block comment */ (Postgres nests these)
    if (two === "/*") {
      let depth = 0;
      const start = i;
      while (i < sql.length) {
        if (sql.slice(i, i + 2) === "/*") {
          depth++;
          i += 2;
          continue;
        }
        if (sql.slice(i, i + 2) === "*/") {
          depth--;
          i += 2;
          if (depth === 0) break;
          continue;
        }
        if (sql[i] === "\n") line++;
        i++;
      }
      buf += sql.slice(start, i);
      continue;
    }

    // 'single-quoted literal', '' escaping a quote
    if (sql[i] === "'") {
      const start = i;
      i++;
      while (i < sql.length) {
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        if (sql[i] === "\n") line++;
        i++;
      }
      buf += sql.slice(start, i);
      continue;
    }

    // "double-quoted identifier"
    if (sql[i] === '"') {
      const start = i;
      i++;
      while (i < sql.length) {
        if (sql[i] === '"') {
          if (sql[i + 1] === '"') {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        if (sql[i] === "\n") line++;
        i++;
      }
      buf += sql.slice(start, i);
      continue;
    }

    // $tag$ dollar-quoted string $tag$ — the one that actually matters here.
    // A tag is $ then an optional identifier then $. Anything else (a bare `$1`
    // parameter, `$` in an operator) is not a dollar quote.
    if (sql[i] === "$") {
      const tag = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (tag) {
        const marker = tag[0];
        const close = sql.indexOf(marker, i + marker.length);
        const stop = close === -1 ? sql.length : close + marker.length;
        const chunk = sql.slice(i, stop);
        line += (chunk.match(/\n/g) || []).length;
        buf += chunk;
        i = stop;
        continue;
      }
    }

    if (sql[i] === ";") {
      const text = buf.trim();
      if (stripped(text)) out.push({ text, line: startLine });
      buf = "";
      i++;
      // The statement that follows starts after any whitespace, but recording
      // the line of the ";" is close enough and never lies about the file.
      startLine = line;
      continue;
    }

    if (sql[i] === "\n") line++;
    if (buf === "" && /\s/.test(sql[i])) {
      i++;
      startLine = line;
      continue;
    }
    buf += sql[i];
    i++;
  }

  const tail = buf.trim();
  if (stripped(tail)) out.push({ text: tail, line: startLine });
  return out;
}

/** Whatever is left once comments are removed — "" means the chunk was only comments. */
function stripped(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .trim();
}

/**
 * The human-readable label of a `select ci.assert(<expr>, '<label>')` statement,
 * or null if this statement is not an assertion.
 *
 * The label is always the last argument and always a plain single-quoted
 * literal, so it can be recovered by scanning backwards from the final ")".
 */
export function assertionLabel(statement) {
  if (!/\bci\.assert\s*\(/i.test(statement)) return null;
  const m = /,\s*'((?:[^']|'')*)'\s*\)\s*$/.exec(statement.replace(/\s+$/, ""));
  return m ? m[1].replace(/''/g, "'") : null;
}
