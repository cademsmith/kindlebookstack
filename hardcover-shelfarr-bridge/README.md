# hardcover-shelfarr-bridge

Auto-requests books from your **Hardcover** "Want to Read" shelf via **Shelfarr**, so new
adds to your shelf show up as download requests without you doing it by hand.

**Pipeline:** Hardcover Want to Read → search Shelfarr's metadata index for a confident
title/author match → create a Shelfarr request (which then flows through Shelfarr's normal
Prowlarr search → download → BookOrbit delivery pipeline, same as a manual request).

## Setup
```bash
cp .env.example .env
```
Fill in:
- `HARDCOVER_API_TOKEN` — personal token from [hardcover.app/account/api](https://hardcover.app/account/api)
- `SHELFARR_API_TOKEN` — a scoped token from Shelfarr's **Profile → API tokens**, with
  `search:read` and `requests:write` scopes
- `SHELFARR_URL` — your Shelfarr instance

## Run
```bash
node scripts/bridge.mjs --dry-run   # see what WOULD be requested, makes no changes
node scripts/bridge.mjs             # live run
node scripts/bridge.mjs --reset     # forget all state, re-evaluate every book from scratch
```

## How matching works
For each Want to Read book, it searches Shelfarr's own `/api/v1/search` and picks the best
candidate: an exact normalized title+author match first, then exact title only, then an
author match above `MIN_CONFIDENCE`. No confident match → skipped and logged, re-checked
on every future run (in case Shelfarr's catalog/metadata improves) rather than requested
blindly.

## State
`data/state.json` tracks every Hardcover book already requested (or flagged as no-match) so
re-runs only act on what's new on your shelf. `data/bridge.log` is the running run log. Both
are local-only (gitignored) — this repo holds the code, not your reading list.

## Throttling
A big Want to Read shelf could otherwise fire dozens of simultaneous grabs at your download
client on the first run. `MAX_REQUESTS_PER_RUN` (default 15) caps new requests per run, with
`REQUEST_DELAY_MS` (default 2000) between them; anything over the cap rolls to the next run.

## Automation (Windows Task Scheduler)
`scripts/run-bridge.bat` runs a live pass and appends to `data/bridge.log`. Point a daily
Task Scheduler task at it, same pattern as this project's sibling recipe importer.

## Notes
- Only requests `BOOK_TYPES` (default `ebook`) — add `audiobook` to also pull those.
- Shelfarr rejecting a request as already-existing/duplicate is treated as success (marked
  requested, not retried).
