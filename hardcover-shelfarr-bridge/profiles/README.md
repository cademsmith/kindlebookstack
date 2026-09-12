# Per-user profiles

Each file here (`<name>.env`) is one Hardcover user's Want-to-Read pipeline. Real
`*.env` files are gitignored (they hold tokens); only this README and
`example.env.example` are committed.

## Add a user

1. In Shelfarr: **Admin → Manage Users** → create their account (so their requests are
   attributed to them and can be governed separately).
2. Sign in as that user → **Profile → API tokens** → create a token with scopes
   **Search + Read requests + Create/cancel requests**. Copy it.
3. Get their **Hardcover** token from `hardcover.app/account/api` (their own account).
4. `cp profiles/example.env.example profiles/<name>.env` and fill in the two tokens.
5. Test: `node scripts/bridge.mjs --profile <name> --dry-run`

That's it. The nightly task (`scripts/run-bridge.bat` → `run-all.mjs`) automatically picks
up every `profiles/*.env`, so there's nothing else to schedule.

## Notes

- The **base `.env`** (repo root of the bridge) is still a valid user and runs alongside the
  profiles as `(base .env)` with `data/state.json`. To make everyone symmetric you can move it
  into a profile: `mv .env profiles/<name>.env` and `mv data/state.json data/state.<name>.json`.
- State is per-user: `data/state.<name>.json`. Reset one user with
  `node scripts/bridge.mjs --profile <name> --reset`.
- All users feed the same Shelfarr → same BookOrbit library. If two people want the same book,
  Shelfarr treats the duplicate as already-handled (no double download).
