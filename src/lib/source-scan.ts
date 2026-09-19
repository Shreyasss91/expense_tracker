/**
 * Source-scanning helpers for the guard tests — **test support only**.
 *
 * Nothing in the app imports this module. It exists because two guards
 * (`test:cache-refresh` and `test:cache-tags`) need to ask questions that only
 * the *shape* of the code can answer: which module a revalidator name came
 * from, whether a call sits inside its guard, and which table a write touches.
 *
 * The approach is deliberately crude — blank out everything that is not code,
 * then match text — because the alternative is a TypeScript parser, and the
 * questions are coarse enough not to need one. What it CANNOT see is stated
 * where it matters rather than hidden here.
 *
 * `blankNonCode` is length-preserving: comments and string/template literals
 * become spaces, but every newline survives, so an index or line number found
 * in the blanked text is the true one in the original file.
 */

/** Replaces every comment with spaces, keeping offsets and newlines (string literals survive). */
export function blankComments(text: string): string {
  return blank(text, false);
}

/** Replaces every comment AND string/template literal with spaces, keeping offsets and newlines. */
export function blankNonCode(text: string): string {
  return blank(text, true);
}

function blank(text: string, literals: boolean): string {
  const out = text.split("");
  const blank = (i: number) => {
    if (out[i] !== "\n") out[i] = " ";
  };

  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") blank(i++);
      continue;
    }
    if (ch === "/" && next === "*") {
      blank(i++);
      blank(i++);
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) blank(i++);
      blank(i++);
      blank(i++);
      continue;
    }
    if (literals && (ch === '"' || ch === "'" || ch === "`")) {
      const quote = ch;
      blank(i++);
      while (i < text.length) {
        if (text[i] === "\\") {
          blank(i++);
          blank(i++);
          continue;
        }
        if (text[i] === quote) {
          blank(i++);
          break;
        }
        blank(i++);
      }
      continue;
    }
    i += 1;
  }

  return out.join("");
}

/**
 * The index of the `)` matching the `(` at `openIndex`, or -1.
 *
 * Reliable only on `blankNonCode` output — in real source a paren inside a
 * string or comment would throw the count off, which is exactly why the
 * blanking pass exists.
 */
export function matchingParen(blanked: string, openIndex: number): number {
  if (blanked[openIndex] !== "(") return -1;
  let depth = 0;
  for (let i = openIndex; i < blanked.length; i += 1) {
    if (blanked[i] === "(") depth += 1;
    else if (blanked[i] === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** The index of the `}` matching the `{` at `openIndex`, or -1. Blanked text only, as above. */
export function matchingBrace(blanked: string, openIndex: number): number {
  if (blanked[openIndex] !== "{") return -1;
  let depth = 0;
  for (let i = openIndex; i < blanked.length; i += 1) {
    if (blanked[i] === "{") depth += 1;
    else if (blanked[i] === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * `function name(...) { ... }` declarations by name — the indirection a cached
 * callback can hide behind (`unstable_cache(() => detect(), ...)` names no table
 * at all; the tables are in `detect`).
 *
 * Only declarations, not arrow-function consts: that is what the one call site
 * that needed this uses, and widening it would mean tracking assignment shapes.
 * A cached callback that hides behind an arrow const is therefore invisible to
 * this scan — `findCachedCallBodies`' callers state that limit.
 */
export function findLocalFunctions(text: string): Map<string, string> {
  const blanked = blankNonCode(text);
  const found = new Map<string, string>();
  for (const m of blanked.matchAll(/(?<![A-Za-z0-9_$.])(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
    const openParen = m.index + m[0].length - 1;
    const closeParen = matchingParen(blanked, openParen);
    if (closeParen < 0) continue;
    const openBrace = blanked.indexOf("{", closeParen);
    if (openBrace < 0) continue;
    const closeBrace = matchingBrace(blanked, openBrace);
    if (closeBrace < 0) continue;
    found.set(m[1], text.slice(openBrace, closeBrace + 1));
  }
  return found;
}

export interface ScannedCall {
  /** The callee exactly as written, e.g. `revalidatePath`. */
  name: string;
  /** Offset of the call in the source, for reading its arguments out of the real text. */
  index: number;
  /** 1-based line number in the original source. */
  line: number;
  /** The callee of the innermost call wrapping this one, or null when it stands alone. */
  guard: string | null;
}

function lineAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) if (text[i] === "\n") line += 1;
  return line;
}

/**
 * Every call to a callee matched by `callee` (with `(` immediately after it),
 * tagged with the call that wraps it.
 *
 * `guard` is how a call site proves it is inside something — an inline
 * `refreshAfterWrite("x", () => revalidatePath("/"))` reports
 * `guard: "refreshAfterWrite"`, while the same call on the next line reports
 * `null`. The innermost wrapper is reported, since that is the one whose
 * `try` decides whether a throw escapes.
 */
export function findCalls(text: string, callee: RegExp): ScannedCall[] {
  const blanked = blankNonCode(text);

  // Every `identifier(` in the file, with its span — the candidate wrappers.
  const spans: { name: string; start: number; end: number }[] = [];
  const callOpen = /(?<![A-Za-z0-9_$.])([A-Za-z_$][\w$]*)\s*\(/g;
  for (const m of blanked.matchAll(callOpen)) {
    const open = m.index + m[0].length - 1;
    const end = matchingParen(blanked, open);
    if (end > open) spans.push({ name: m[1], start: m.index, end });
  }

  const sites: ScannedCall[] = [];
  const pattern = new RegExp(`${callee.source}\\s*\\(`, "g");
  for (const m of blanked.matchAll(pattern)) {
    const index = m.index;
    // A call appearing in a comment or a string is not a call site; the callee
    // itself would have been blanked, so it can no longer match at all.
    const wrappers = spans
      .filter((s) => s.start < index && index < s.end)
      .sort((a, b) => a.start - b.start);
    const innermost = wrappers[wrappers.length - 1] ?? null;
    sites.push({
      name: m[0].replace(/\s*\($/, ""),
      index,
      line: lineAt(text, index),
      guard: innermost ? innermost.name : null,
    });
  }
  return sites;
}

export interface TableWrite {
  op: "insert" | "update" | "delete";
  table: string;
  line: number;
}

/** `db.insert(table)` / `.update(table)` / `.delete(table)` chains — multi-line chains included. */
export function findTableWrites(text: string): TableWrite[] {
  const blanked = blankNonCode(text);
  const writes: TableWrite[] = [];
  for (const m of blanked.matchAll(/\.(insert|update|delete)\(\s*([A-Za-z_$][\w$]*)/g)) {
    writes.push({
      op: m[1] as TableWrite["op"],
      table: m[2],
      line: lineAt(text, m.index),
    });
  }
  return writes;
}

/** The source text of every `unstable_cache(...)` call, in file order. */
export function findCachedCallBodies(text: string): { body: string; line: number }[] {
  const blanked = blankNonCode(text);
  const bodies: { body: string; line: number }[] = [];
  for (const m of blanked.matchAll(/(?<![A-Za-z0-9_$.])unstable_cache\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    const end = matchingParen(blanked, open);
    if (end > open) bodies.push({ body: text.slice(m.index, end + 1), line: lineAt(text, m.index) });
  }
  return bodies;
}
