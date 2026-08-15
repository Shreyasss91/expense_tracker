// Extracts settings server-action IDs from the dev build's static chunks.
// Chunk format: (0, mod.createServerReference)("id", callServer, void 0, findSourceMapURL, \"ActionName\")
// Dev chunks serialize the name argument with a backslash before the quote,
// so we scan for the literal sequence: createServerReference)("<id>", ..., \"<name>\"
const fs = require("fs");
const path = require("path");

const BS = String.fromCharCode(92); // backslash

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".js")) out.push(p);
  }
  return out;
}

function findId(src, name) {
  const needle = BS + '"' + name + BS + '"';
  const anchor = "createServerReference)(" + BS + '"';
  let idx = src.indexOf(needle);
  while (idx !== -1) {
    // the action-entry map also contains "id":"name" BEFORE the registration
    // line, so walk past occurrences that have no registration anchor before them
    const aIdx = src.lastIndexOf(anchor, idx);
    if (aIdx !== -1) {
      const idStart = aIdx + anchor.length;
      const idEnd = src.indexOf(BS + '"', idStart);
      if (idEnd !== -1 && idEnd < idx) return src.slice(idStart, idEnd);
    }
    idx = src.indexOf(needle, idx + 1);
  }
  return null;
}

const files = walk(path.join(__dirname, "..", ".next", "static", "chunks"));
const wanted = ["updateCategory", "updateMember", "reorderCategories", "reorderMembers"];
for (const name of wanted) {
  let id = null;
  for (const f of files) {
    id = findId(fs.readFileSync(f, "utf8"), name);
    if (id) break;
  }
  console.log(name, "=", id ?? "NOT FOUND");
}
