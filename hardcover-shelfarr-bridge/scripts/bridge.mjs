// Hardcover "Want to Read" -> Shelfarr request bridge.
//
// Pulls your Hardcover Want to Read shelf (status_id=1) via the Hardcover GraphQL API,
// searches Shelfarr's own metadata search for each title, and creates a Shelfarr request
// for the best confident match. Resumable: books already requested (or already flagged as
// no-match) are tracked in data/state.json so a re-run only handles what's new on the shelf.
//
// Requests trickle out MAX_REQUESTS_PER_RUN at a time (default 15) so a big Want to Read
// shelf doesn't slam Prowlarr/your download client with dozens of simultaneous grabs.
//
// Usage:
//   node scripts/bridge.mjs              # live run
//   node scripts/bridge.mjs --dry-run    # show what WOULD be requested, no writes to Shelfarr
//   node scripts/bridge.mjs --reset      # forget all state (re-evaluate every book from scratch)

import { loadEnv, BASE_ENV } from "../lib/env.js";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const args = process.argv.slice(2);

// --profile <name> (or PROFILE env) runs one user: it loads profiles/<name>.env — a
// self-contained file with that user's own HARDCOVER_API_TOKEN + SHELFARR_API_TOKEN — and
// tracks its own data/state.<name>.json so users never clobber each other's progress. With no
// profile it falls back to the base .env + data/state.json (the original single-user setup),
// so existing installs keep working unchanged. Run every profile at once with run-all.mjs.
function flagValue(flag) {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : null;
}
const PROFILE = flagValue("--profile") || process.env.PROFILE || null;
loadEnv(PROFILE ? path.join(__dirname, "..", "profiles", `${PROFILE}.env`) : BASE_ENV);

const STATE_FILE = path.join(DATA_DIR, PROFILE ? `state.${PROFILE}.json` : "state.json");
const LOG = PROFILE ? `[${PROFILE}] ` : "";

const HARDCOVER_URL = "https://api.hardcover.app/v1/graphql";
const HARDCOVER_TOKEN = process.env.HARDCOVER_API_TOKEN;
const SHELFARR_URL = (process.env.SHELFARR_URL || "http://192.168.1.56:5056").replace(/\/$/, "");
const SHELFARR_TOKEN = process.env.SHELFARR_API_TOKEN;
// Every listed format that's available for a book gets its own request (e.g. both the ebook
// AND the audiobook when both exist). Order is cosmetic. Override per-user in profiles/<name>.env.
const BOOK_TYPES = (process.env.BOOK_TYPES || "ebook,audiobook").split(",").map((s) => s.trim()).filter(Boolean);
const MIN_CONFIDENCE = Number(process.env.MIN_CONFIDENCE || 50);
const MAX_REQUESTS_PER_RUN = Number(process.env.MAX_REQUESTS_PER_RUN || 15);
const REQUEST_DELAY_MS = Number(process.env.REQUEST_DELAY_MS || 2000);
// Shelfarr merges in Hardcover as a metadata provider on every /api/v1/search call, so
// searches count against Hardcover's own rate limit (60/min, burst 10) too, not just
// direct Hardcover calls. Throttle between searches to stay well under that.
const SEARCH_DELAY_MS = Number(process.env.SEARCH_DELAY_MS || 1200);

const DRY_RUN = process.env.DRY_RUN === "true" || args.includes("--dry-run");

function assertEnv() {
  const missing = [];
  if (!HARDCOVER_TOKEN) missing.push("HARDCOVER_API_TOKEN");
  if (!SHELFARR_TOKEN) missing.push("SHELFARR_API_TOKEN");
  if (missing.length) {
    const where = PROFILE ? `profiles/${PROFILE}.env` : ".env (copy .env.example)";
    console.error(`${LOG}Missing required env vars: ${missing.join(", ")}. Set them in ${where}.`);
    process.exit(1);
  }
}

async function readState() {
  if (!existsSync(STATE_FILE)) return {};
  try {
    return JSON.parse(await readFile(STATE_FILE, "utf-8"));
  } catch {
    return {};
  }
}

async function writeState(state) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
}

function normalize(str) {
  return (str || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/^(the|a|an)\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function authorsMatch(hcAuthors, candidateAuthor) {
  if (!candidateAuthor) return false;
  const candNorm = normalize(candidateAuthor);
  if (!candNorm) return false;
  return hcAuthors.some((a) => {
    const n = normalize(a);
    if (!n) return false;
    const lastWord = n.split(" ").pop();
    return n === candNorm || candNorm.includes(lastWord);
  });
}

function sortByConfidence(list) {
  return [...list].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
}

async function fetchWantToRead() {
  const books = [];
  const limit = 200;
  let offset = 0;
  for (;;) {
    const query = `{
      me {
        user_books(where: {status_id: {_eq: 1}}, order_by: {id: asc}, limit: ${limit}, offset: ${offset}) {
          book { id title contributions { author { name } } }
        }
      }
    }`;
    const res = await fetch(HARDCOVER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${HARDCOVER_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) throw new Error(`Hardcover API HTTP ${res.status}: ${await res.text()}`);
    const json = await res.json();
    if (json.errors) throw new Error(`Hardcover API error: ${JSON.stringify(json.errors)}`);
    const me = Array.isArray(json.data.me) ? json.data.me[0] : json.data.me;
    const page = me?.user_books || [];
    for (const ub of page) {
      books.push({
        hardcoverBookId: ub.book.id,
        title: ub.book.title,
        authors: (ub.book.contributions || []).map((c) => c.author?.name).filter(Boolean),
      });
    }
    if (page.length < limit) break;
    offset += limit;
  }
  return books;
}

async function searchShelfarr(title) {
  const url = `${SHELFARR_URL}/api/v1/search?q=${encodeURIComponent(title)}&limit=8`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${SHELFARR_TOKEN}` } });
  if (!res.ok) throw new Error(`Shelfarr search HTTP ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json.results || [];
}

function pickBestMatch(book, results) {
  const wantTitle = normalize(book.title);
  const withType = results.filter((r) => BOOK_TYPES.some((t) => (r.available_book_types || []).includes(t)));
  if (!withType.length) return null;

  let candidates = withType.filter((r) => normalize(r.title) === wantTitle && authorsMatch(book.authors, r.author));
  if (candidates.length) return sortByConfidence(candidates)[0];

  candidates = withType.filter((r) => normalize(r.title) === wantTitle);
  if (candidates.length) return sortByConfidence(candidates)[0];

  candidates = withType.filter((r) => authorsMatch(book.authors, r.author) && (r.confidence ?? 0) >= MIN_CONFIDENCE);
  if (candidates.length) return sortByConfidence(candidates)[0];

  return null;
}

// Formats already really-requested for a book (backward compatible with the old single
// bookType schema, so existing state.json isn't re-requested wholesale).
function doneTypesOf(entry) {
  if (!entry) return new Set();
  if (Array.isArray(entry.requestedTypes)) return new Set(entry.requestedTypes);
  if (entry.status === "requested" && !entry.dryRun && entry.bookType) return new Set([entry.bookType]);
  return new Set();
}

async function createRequest(match, bookType) {
  if (DRY_RUN) return { ok: true, dryRun: true, bookType };

  const res = await fetch(`${SHELFARR_URL}/api/v1/requests`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SHELFARR_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      work_id: match.work_id,
      book_type: bookType,
      title: match.title,
      author: match.author,
    }),
  });
  const text = await res.text();
  if (res.ok) return { ok: true, bookType, raw: text };
  if (res.status === 409 || /already|duplicate|exists/i.test(text)) {
    return { ok: true, alreadyExisted: true, bookType, raw: text };
  }
  return { ok: false, status: res.status, raw: text };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  assertEnv();

  if (args.includes("--reset")) {
    await writeState({});
    console.log("State reset — every Want to Read book will be re-evaluated on the next run.");
    return;
  }

  const state = await readState();

  console.log(`${LOG}Fetching Hardcover "Want to Read" list...`);
  const wantToRead = await fetchWantToRead();
  console.log(
    `${LOG}Found ${wantToRead.length} books on Want to Read. Requesting book type(s): ${BOOK_TYPES.join(", ")}.` +
      (DRY_RUN ? " [DRY RUN — nothing will be sent to Shelfarr]" : "")
  );

  let requestedThisRun = 0;
  let alreadyHandled = 0;
  let skippedNoMatch = 0;
  let failed = 0;
  let cappedRemaining = 0;

  for (const book of wantToRead) {
    const key = String(book.hardcoverBookId);
    const done = doneTypesOf(state[key]); // formats already requested for this book
    const wanted = BOOK_TYPES.filter((t) => !done.has(t)); // formats still to get

    if (!wanted.length) {
      alreadyHandled++;
      continue;
    }

    if (!DRY_RUN && requestedThisRun >= MAX_REQUESTS_PER_RUN) {
      cappedRemaining++;
      continue;
    }

    let results;
    try {
      results = await searchShelfarr(book.title);
    } catch (err) {
      console.log(`${LOG}  [ERROR] search failed for "${book.title}": ${err.message}`);
      failed++;
      await sleep(SEARCH_DELAY_MS);
      continue;
    }
    await sleep(SEARCH_DELAY_MS);

    const match = pickBestMatch(book, results);
    if (!match) {
      console.log(`${LOG}  [SKIP] no confident match for "${book.title}" by ${book.authors.join(", ") || "?"}`);
      if (!done.size) state[key] = { title: book.title, status: "skipped-no-match", checkedAt: new Date().toISOString() };
      skippedNoMatch++;
      if (!DRY_RUN && !done.size) await writeState(state);
      continue;
    }

    const available = match.available_book_types || [];
    const toRequest = wanted.filter((t) => available.includes(t));
    if (!toRequest.length) {
      // Found the book, but the still-wanted format(s) aren't available yet — re-check next run.
      console.log(`${LOG}  [SKIP] "${match.title}" — ${wanted.join("/")} not available (has: ${available.join(", ") || "none"})`);
      skippedNoMatch++;
      continue;
    }

    let anyRequested = false;
    for (const bookType of toRequest) {
      if (!DRY_RUN && requestedThisRun >= MAX_REQUESTS_PER_RUN) {
        cappedRemaining++;
        break;
      }
      const result = await createRequest(match, bookType);
      if (result.ok) {
        if (!DRY_RUN) done.add(bookType);
        anyRequested = true;
        requestedThisRun++;
        const tag = DRY_RUN ? "DRY-RUN WOULD REQUEST" : result.alreadyExisted ? "ALREADY REQUESTED" : "REQUESTED";
        console.log(`${LOG}  [${tag}] "${match.title}" by ${match.author} (${bookType}, confidence ${match.confidence})`);
      } else {
        console.log(`${LOG}  [ERROR] request failed for "${match.title}" (${bookType}): HTTP ${result.status} ${result.raw}`);
        failed++;
      }
      if (!DRY_RUN) await sleep(REQUEST_DELAY_MS);
    }

    if (!DRY_RUN && anyRequested) {
      state[key] = {
        title: book.title,
        status: "requested",
        requestedTypes: [...done],
        workId: match.work_id,
        updatedAt: new Date().toISOString(),
      };
      await writeState(state);
    }
  }

  console.log(
    `\n${LOG}Done. ${requestedThisRun} requested this run, ${alreadyHandled} already handled, ` +
      `${skippedNoMatch} skipped (no confident match), ${failed} failed` +
      (cappedRemaining ? `, ${cappedRemaining} deferred to next run (MAX_REQUESTS_PER_RUN=${MAX_REQUESTS_PER_RUN})` : "") +
      "."
  );
  if (DRY_RUN) console.log("This was a dry run — nothing was actually sent to Shelfarr.");
}

main().catch((e) => {
  console.error("Bridge error:", e.message);
  process.exit(1);
});
