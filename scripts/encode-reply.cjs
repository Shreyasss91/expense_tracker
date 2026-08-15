// Builds a server-action body with React's own encodeReply (guaranteed to
// match the browser's wire format) and POSTs it. Usage:
//   node scripts/encode-reply.cjs <actionId> <url> <jsonArgFile>
const fs = require("fs");
const { encodeReply } = require("next/dist/compiled/react-server-dom-webpack/cjs/react-server-dom-webpack-client.node.unbundled.development.js");

const [, , actionId, url, argFile] = process.argv;
const arg = JSON.parse(fs.readFileSync(argFile, "utf8"));

(async () => {
  const body = await encodeReply([arg]);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Next-Action": actionId,
      "Content-Type": "text/plain;charset=UTF-8",
      Cookie: process.env.SESSION_COOKIE || "",
    },
    body,
  });
  const text = await res.text();
  console.log("status:", res.status);
  console.log("body:", text.slice(0, 400));
})().catch((e) => {
  console.error("ERR", e);
  process.exit(1);
});
