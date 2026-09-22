// Answers one question honestly: is the public site actually serving the commit I just merged?
//
// Written after reporting "Pages: success" for a change whose deploy had not started — right after a
// merge, "the latest workflow run" is usually the PREVIOUS run. A green workflow, an HTTP 200 and a
// "published: true" are all proxies. The thing itself is the bytes the public URL returns.
//
//   node scripts/ui/live-serves.mjs                     # checks origin/main's newest site change
//   node scripts/ui/live-serves.mjs "some exact string" # checks for a string you name
import { execFileSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const SITE = process.env.SITE_URL ?? "https://forifor.github.io/oathra";
const deadlineMs = Number(process.env.LIVE_WAIT_MS ?? 600_000);
const git = (...a) => execFileSync("git", a, { encoding: "utf8" }).trim();

/** A string that is in the local build and not in the previous one, so it proves which build is served. */
function markerFromLastSiteCommit() {
  const commit = git("log", "-1", "--format=%H", "--", "site/index.html");
  const diff = git("show", commit, "--", "site/index.html");
  for (const line of diff.split("\n")) {
    if (!line.startsWith("+") || line.startsWith("+++")) continue;
    // A distinctive run of visible text, long enough not to appear by accident.
    const text = line.slice(1).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    for (const piece of text.split(/[。.·|]/)) {
      const t = piece.trim();
      if (t.length >= 18 && !/^[\s{}();:,]*$/.test(t)) return { marker: t, commit };
    }
  }
  throw new Error(`No usable marker in ${commit}. Pass one as an argument.`);
}

const { marker, commit } = process.argv[2] ? { marker: process.argv[2], commit: "(given)" } : markerFromLastSiteCommit();
console.log(`waiting for ${SITE} to serve: "${marker.slice(0, 60)}"${commit === "(given)" ? "" : `  (from ${commit.slice(0, 8)})`}`);

const started = Date.now();
for (let attempt = 1; ; attempt++) {
  let body = "";
  try { const r = await fetch(SITE + "/", { cache: "no-store" }); body = await r.text(); } catch { /* retry */ }
  // The marker was built from text with its tags stripped, so the page has to be read the same way:
  // a sentence wrapping a link does not appear literally in the HTML. (This check's own first bug.)
  const readable = body.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
  if (readable.includes(marker)) {
    console.log(`SERVED after ${Math.round((Date.now() - started) / 1000)}s (attempt ${attempt})`);
    process.exit(0);
  }
  if (Date.now() - started > deadlineMs) {
    console.error(`NOT SERVED after ${Math.round(deadlineMs / 1000)}s. The workflow may be green while the change is not public.`);
    process.exit(1);
  }
  await sleep(15_000);
}
