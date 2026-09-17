import assert from "node:assert/strict";
import { matchOccurrences } from "./import-dedup";

const A = "2026-09-01|09:15|m1|100.00|fuel";
const B = "2026-09-02|10:00|m1|50.00|chai";

// Two identical rows in the backup, one left in the database: only the first
// is excused, the missing copy must restore.
assert.deepEqual([...matchOccurrences([A], [A, A])], [0]);

// No copies in the database: nothing is excused, both rows restore.
assert.deepEqual([...matchOccurrences([], [A, A])], []);

// Every copy still present: everything is excused.
assert.deepEqual([...matchOccurrences([A, A], [A, A])], [0, 1]);

// More copies in the database than in the file: the file adds nothing.
assert.deepEqual([...matchOccurrences([A, A, A], [A])], [0]);

// Distinct rows match independently.
assert.deepEqual([...matchOccurrences([A], [A, B])], [0]);
assert.deepEqual([...matchOccurrences([B], [A, B])], [1]);

// Unresolvable rows (null) never match, even when the fingerprint exists.
assert.deepEqual([...matchOccurrences([A], [null, A])], [1]);

console.log("Import occurrence-matching tests passed");
