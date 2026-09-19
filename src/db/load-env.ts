/**
 * Load `.env.local` as a **side effect**, for DB test scripts whose imports read
 * `process.env.DATABASE_URL` at module-evaluation time.
 *
 * `src/db/index.ts` constructs its neon client at module scope, so calling
 * `config()` in the entry file's own body comes too late: ESM evaluates every
 * import before it runs that body, and the client would be built from an empty
 * string. Importing this module **first** fixes the order, because ESM evaluates
 * imports in source order.
 *
 * The other DB test scripts call `config()` inline instead, which works for them
 * only because the modules they import are *parameterized* on `db` (`setAppSetting(db, …)`)
 * rather than importing the singleton — so nothing they load reads the variable
 * early. Anything importing `getLedgerFeed` does not have that luxury.
 *
 * `dotenv` never overwrites a variable that is already set, so CI's
 * `DATABASE_URL` from the job's `env:` wins, and a missing `.env.local` — the
 * normal case there — is harmless rather than fatal.
 */
import { config } from "dotenv";

config({ path: ".env.local" });
