#!/usr/bin/env node
/**
 * Publish the single, current intake announcement through the existing X
 * user-context credentials. The default command is read-only. Publishing
 * requires --publish and rechecks the account-wide spacing immediately before
 * uploading media.
 */
import { createHmac, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const DRAFT = resolve(ROOT, "docs/launch/x-transcript-check.txt");
const MEDIA = resolve(ROOT, "docs/media/oathra-intake.mp4");
const STATE = resolve(ROOT, "docs/launch/metrics/x-intake-publication.json");
const MIN_GAP_MS = 24 * 60 * 60 * 1000;

const args = new Set(process.argv.slice(2));
const publish = args.has("--publish");
const validate = args.has("--validate");

function readEnv(path = resolve(ROOT, ".env")) {
  const result = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match || match[1].startsWith("#")) continue;
    result[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
  return result;
}

let env;

function encode(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function oauthHeader(method, baseUrl, query = {}) {
  const oauth = {
    oauth_consumer_key: env.X_API_KEY,
    oauth_nonce: randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000),
    oauth_token: env.X_ACCESS_TOKEN,
    oauth_version: "1.0",
  };
  const params = { ...oauth, ...query };
  const pairs = Object.entries(params)
    .map(([key, value]) => [encode(key), encode(value)])
    .sort(([ak, av], [bk, bv]) => ak === bk ? av.localeCompare(bv) : ak.localeCompare(bk))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  const signatureBase = `${method.toUpperCase()}&${encode(baseUrl)}&${encode(pairs)}`;
  const signingKey = `${encode(env.X_API_SECRET)}&${encode(env.X_ACCESS_SECRET)}`;
  const signature = createHmac("sha1", signingKey).update(signatureBase).digest("base64");
  return `OAuth ${Object.entries({ ...oauth, oauth_signature: signature })
    .map(([key, value]) => `${encode(key)}="${encode(value)}"`)
    .join(", ")}`;
}

async function request(method, baseUrl, { query = {}, body, headers = {} } = {}) {
  const url = new URL(baseUrl);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
  const response = await fetch(url, {
    method,
    headers: { Authorization: oauthHeader(method, baseUrl, query), ...headers },
    ...(body === undefined ? {} : { body }),
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!response.ok) throw new Error(`${method} ${baseUrl} returned ${response.status}: ${JSON.stringify(data).slice(0, 1000)}`);
  return data;
}

/**
 * Retry only idempotent reads after transient provider failures. Publication
 * POSTs intentionally continue to use request() directly so a timeout can
 * never create an unnoticed duplicate post.
 */
async function requestRead(baseUrl, options = {}, attempts = 3) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await request("GET", baseUrl, options);
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const transient = / returned (?:429|5\d\d):/.test(message);
      if (!transient || attempt === attempts - 1) throw error;
      await new Promise((resolveWait) => setTimeout(resolveWait, 1000 * 2 ** attempt));
    }
  }
  throw lastError;
}

function draftText() {
  const source = readFileSync(DRAFT, "utf8");
  const match = /^A phone agent[\s\S]*?(?=\nBefore publishing)/m.exec(source);
  if (!match) throw new Error(`Could not find the active post body in ${DRAFT}`);
  const text = match[0].trim();
  if ([...text].length > 280) throw new Error(`The active post is ${[...text].length} characters; X allows at most 280.`);
  return text;
}

async function accountAndTweets() {
  const me = await requestRead("https://api.twitter.com/2/users/me", {
    query: { "user.fields": "id,name,username,public_metrics" },
  });
  const tweets = await requestRead(`https://api.twitter.com/2/users/${me.data.id}/tweets`, {
    query: { max_results: "100", exclude: "retweets,replies", "tweet.fields": "created_at,public_metrics,text" },
  });
  return { me: me.data, tweets: tweets.data ?? [] };
}

function publicationCheck(tweets, text) {
  const now = Date.now();
  const latest = tweets
    .filter((tweet) => tweet.created_at)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  const latestAt = latest ? Date.parse(latest.created_at) : 0;
  const eligibleAt = latestAt ? latestAt + MIN_GAP_MS : now;
  const duplicate = tweets.some((tweet) => tweet.text?.trim() === text.trim());
  return {
    eligible: !latest || now >= eligibleAt,
    duplicate,
    latest: latest ? { id: latest.id, createdAt: latest.created_at, text: latest.text, metrics: latest.public_metrics } : null,
    eligibleAt: new Date(eligibleAt).toISOString(),
  };
}

async function uploadVideo() {
  const bytes = readFileSync(MEDIA);
  const form = new FormData();
  form.append("media", new Blob([bytes], { type: "video/mp4" }), "oathra-intake.mp4");
  form.append("media_category", "tweet_video");
  const uploaded = await request("POST", "https://upload.twitter.com/1.1/media/upload.json", { body: form });
  if (!uploaded.media_id_string) throw new Error("X media upload returned no media id");
  let info = uploaded;
  for (let attempt = 0; info.processing_info && attempt < 12; attempt++) {
    const state = info.processing_info.state;
    if (state === "succeeded") break;
    if (state === "failed") throw new Error(`X media processing failed: ${JSON.stringify(info.processing_info)}`);
    const waitMs = Math.max(2, Number(info.processing_info.check_after_secs ?? 2)) * 1000;
    await new Promise((resolveWait) => setTimeout(resolveWait, waitMs));
    info = await requestRead("https://upload.twitter.com/1.1/media/upload.json", {
      query: { command: "STATUS", media_id: uploaded.media_id_string },
    });
  }
  if (info.processing_info?.state && info.processing_info.state !== "succeeded") {
    throw new Error(`X media processing did not finish: ${JSON.stringify(info.processing_info)}`);
  }
  return uploaded.media_id_string;
}

const text = draftText();
if (validate) {
  console.log(JSON.stringify({ draft: "docs/launch/x-transcript-check.txt", characters: [...text].length, maxCharacters: 280, valid: [...text].length <= 280 }, null, 2));
  process.exit(0);
}

env = readEnv();
for (const key of ["X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_SECRET"]) {
  if (!env[key]) throw new Error(`Missing ${key} in .env`);
}

const { me, tweets } = await accountAndTweets();
const check = publicationCheck(tweets, text);
console.log(JSON.stringify({ mode: publish ? "publish" : "check", account: { id: me.id, username: me.username, metrics: me.public_metrics }, ...check }, null, 2));

if (!publish) process.exit(0);
if (!check.eligible) throw new Error(`24-hour spacing is not complete; earliest eligible time is ${check.eligibleAt}`);
if (check.duplicate) throw new Error("The active post body already exists on this account; refusing a duplicate.");

const mediaId = await uploadVideo();
const created = await request("POST", "https://api.twitter.com/2/tweets", {
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ text, media: { media_ids: [String(mediaId)] } }),
});
const record = {
  postedAt: new Date().toISOString(),
  id: created.data.id,
  url: `https://x.com/${me.username}/status/${created.data.id}`,
  username: me.username,
  mediaId: String(mediaId),
  text,
  sourceDraft: "docs/launch/x-transcript-check.txt",
  sourceMedia: "docs/media/oathra-intake.mp4",
};
writeFileSync(STATE, `${JSON.stringify(record, null, 2)}\n`);
console.log(JSON.stringify(record, null, 2));
