import { strict as assert } from "node:assert";
import { parseCsv } from "./csv.mjs";

const csv = [
  'a,"b,c","quoted ""value""",plain',
  '1,"line 1\nline 2",,last',
].join("\r\n") + "\r\n";

assert.deepEqual(parseCsv(csv), [
  ["a", "b,c", 'quoted "value"', "plain"],
  ["1", "line 1\nline 2", "", "last"],
]);

assert.deepEqual(parseCsv("a,b\n1,2\n"), [
  ["a", "b"],
  ["1", "2"],
]);

assert.throws(
  () => parseCsv('a,"unterminated\n'),
  /unterminated quoted field/,
);

console.log("CSV parser OK — RFC 4180 adversarial cases and malformed-input rejection pass.");
