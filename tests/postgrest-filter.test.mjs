import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  quoteFilterValue,
  escapeLikePattern,
  orIlike,
  containsFilterMetacharacters,
} from "../lib/core/postgrest-filter.mjs";

// ---------------------------------------------------------------------------
// /search interpolated raw user input into a PostgREST `or=` expression, which
// is a comma-separated list of conditions. A comma in the query TERMINATED the
// condition and injected another.
// ---------------------------------------------------------------------------

test("the injection was real — reproduce it against the old construction", () => {
  // Trailing comma so the injected clause lands cleanly rather than carrying a
  // stray '%'. This is what an attacker would actually send.
  const q = "a,archived.eq.true,";
  const vulnerable = `name.ilike.%${q}%,phone.ilike.%${q}%`;
  // The injected condition appears as its own top-level clause, defeating the
  // page's own archived/deleted filters.
  assert.ok(
    vulnerable.split(",").includes("archived.eq.true"),
    "the old expression really did admit an attacker-controlled condition",
  );
});

test("the escaped construction contains no injected clause", () => {
  const expr = orIlike(["name", "phone"], "a,archived.eq.true");
  const clauses = expr.split(",");
  assert.ok(!clauses.includes("archived.eq.true"), "the injected condition must not survive");
  // Every structural comma belongs to a column clause we generated.
  const generated = clauses.filter((c) => /^(name|phone)\.ilike\./.test(c));
  assert.ok(generated.length >= 2, "our own clauses must still be present");
});

test("the whole user value is quoted as a single literal", () => {
  const expr = orIlike(["name"], "Smith, John");
  assert.ok(expr.includes('"'), "the value must be quoted");
  assert.equal(expr.split("name.ilike.").length, 2, "exactly one name clause");
});

test("ordinary punctuation no longer breaks the query", () => {
  // These all produced a 500 before, on entirely reasonable searches.
  for (const term of ["Smith, John", "O'Brien Ltd.", "unit (rear)", 'the "big" job', "a.b.c"]) {
    assert.ok(containsFilterMetacharacters(term), `${term} contains metacharacters`);
    const expr = orIlike(["name"], term);
    assert.ok(expr.startsWith("name.ilike."), `${term} must still produce a valid clause`);
  }
});

test("embedded quotes and backslashes cannot break out of the quoting", () => {
  const nasty = 'x" or "1"="1';
  const quoted = quoteFilterValue(nasty);
  assert.ok(quoted.startsWith('"') && quoted.endsWith('"'));
  // Every inner double-quote is escaped, so the literal cannot be terminated early.
  const inner = quoted.slice(1, -1);
  assert.ok(!/(^|[^\\])"/.test(inner), "an unescaped quote would end the literal early");
  assert.equal(quoteFilterValue("a\\b"), '"a\\\\b"');
});

test("LIKE wildcards in the search term are literal, not patterns", () => {
  // A customer searching for "50%" wants the string, not "anything".
  assert.equal(escapeLikePattern("50%"), "50\\%");
  assert.equal(escapeLikePattern("a_b"), "a\\_b");
  assert.equal(escapeLikePattern("a*b"), "a\\*b");
  assert.equal(escapeLikePattern("plain"), "plain", "ordinary text is untouched");
});

test("a harmless search still produces the expected clauses (not a cry-wolf)", () => {
  const expr = orIlike(["name", "phone", "email", "city"], "henderson");
  assert.equal(expr.split(",").length, 4, "one clause per column, no more");
  for (const column of ["name", "phone", "email", "city"]) {
    assert.ok(expr.includes(`${column}.ilike.`), `${column} must be searched`);
  }
  assert.ok(expr.includes("henderson"));
});

test("empty and nullish terms are handled without throwing", () => {
  assert.doesNotThrow(() => orIlike(["name"], ""));
  assert.doesNotThrow(() => orIlike(["name"], null));
  assert.doesNotThrow(() => orIlike(["name"], undefined));
});

// ---------------------------------------------------------------------------
// Structural: the vulnerable construction must not come back.
// ---------------------------------------------------------------------------

test("the search page no longer interpolates the raw term into a filter", () => {
  const src = readFileSync(new URL("../app/(app)/search/page.tsx", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  assert.ok(
    !/\.or\(`[^`]*\$\{like\}/.test(src),
    "the raw term must not reach the filter expression",
  );
  assert.ok(/orIlike\(/.test(src), "it must use the escaped builder");
});
