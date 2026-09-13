// Read-only acquisition snapshot. Auth comes from gh; never writes credentials.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
const exec = promisify(execFile);
const base = "repos/FORIFOR/oathra";
async function gh(path) {
  const { stdout } = await exec("gh", ["api", path], { timeout: 20000, maxBuffer: 2_000_000 });
  return JSON.parse(stdout);
}
async function article(slug) {
  const response = await fetch(`https://zenn.dev/api/articles/${slug}`, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const { article: a } = await response.json();
  return { slug, likes: a.liked_count ?? null, comments: a.comments_count ?? null, published: a.published_at ?? null };
}
const sources = {
  repository: () => gh(base).then(r => ({ stars: r.stargazers_count, forks: r.forks_count, pushedAt: r.pushed_at })),
  views14days: () => gh(`${base}/traffic/views`),
  clones14days: () => gh(`${base}/traffic/clones`),
  referrers14days: () => gh(`${base}/traffic/popular/referrers`),
  externalIssues: () => gh(`${base}/issues?state=all&per_page=100`).then(rows => ({
    first100IssuesAndPullRequests: true,
    issues: rows.filter(i => !i.pull_request && i.user.login !== "FORIFOR" && i.user.type !== "Bot")
      .map(i => ({ number: i.number, state: i.state, url: i.html_url, createdAt: i.created_at })),
  })),
  releases: () => gh(`${base}/releases?per_page=5`).then(rows => rows.filter(r => !r.draft).map(r => ({
    tag: r.tag_name, publishedAt: r.published_at,
    assets: r.assets.map(a => ({ name: a.name, downloads: a.download_count })),
  }))),
  zennLaunch: () => article("oathra-launch"),
  zennEvidence: () => article("oathra-evidence-rules"),
};
const entries = await Promise.all(Object.entries(sources).map(async ([name, run]) => {
  try { return [name, { available: true, value: await run() }]; }
  catch { return [name, { available: false, value: null }]; }
}));
const snapshot = {
  capturedAt: new Date().toISOString(),
  sources: Object.fromEntries(entries),
  interpretation: [
    "Unavailable data is unknown, never zero. Traffic can lag; compare daily buckets, not summed overlapping windows.",
    "Views, clones and asset downloads include maintainer/automation checks and cannot count external users.",
    "Zenn likes are not page views. This snapshot does not measure X impressions, website conversion, retention or private business inquiries.",
    "An external issue is a signal to investigate, not proof of adoption. Stars alone do not establish business demand.",
  ],
};
const text = JSON.stringify(snapshot, null, 2) + "\n";
if (process.argv[2]) {
  const path = resolve(process.argv[2]);
  mkdirSync(dirname(path), { recursive: true });
  // Keep earlier observations immutable; use a new timestamped filename.
  writeFileSync(path, text, { flag: "wx" });
}
console.log(text);
