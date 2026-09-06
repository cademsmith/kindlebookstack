# kindlebookstack — BookOrbit + Shelfarr

Self-hosted book stack:
- **BookOrbit** — one app for **ebooks, PDFs, comics, and audiobooks**, with a web
  reader, **KOReader/Kobo sync**, **OPDS**, and **Send-to-Kindle** — a single replacement for
  calibre-web + AudioBookShelf. Ships with its own PostgreSQL (pgvector).
- **Shelfarr** — an Overseerr-style **request + auto-download** portal for books/audiobooks.
  Searches via **Prowlarr**, grabs via your existing download client (e.g. Transmission),
  and delivers finished files straight into BookOrbit's library folders.

**Pipeline:** request in Shelfarr → Prowlarr searches → download client fetches it →
Shelfarr imports into BookOrbit's `ebooks`/`audiobooks` folders → BookOrbit scans & serves it.

## Deploy BookOrbit (Portainer)
1. **Stacks → + Add stack** → name `bookorbit` → **Web editor** → paste `docker-compose.yml`.
2. In **Environment variables**, add the entries from [`.env.example`](.env.example) with your real values:
   - Generate secrets: `openssl rand -hex 32` for `JWT_SECRET` and `SETUP_BOOTSTRAP_TOKEN`; a strong `POSTGRES_PASSWORD`.
   - Set `APP_URL` to how you reach it, e.g. `http://192.168.1.56:3000`.
   - Set the host paths (`BOOKS_HOST_PATH`, `APP_DATA_HOST_PATH`, `DB_DATA_HOST_PATH`).
3. **Deploy the stack.**

## Deploy BookOrbit (CLI)
```bash
cp .env.example .env    # fill in secrets + paths
docker compose up -d
```

### BookOrbit first run
1. Open `http://HOST:3000` (give it a minute to init PostgreSQL).
2. Complete the **setup** screen — paste your `SETUP_BOOTSTRAP_TOKEN` when asked, then create your admin account.
3. Create a **Library** pointing at `/books` (or separate Ebooks/Audiobooks libraries — see Notes).

### BookOrbit notes
- If port `3000` is taken, change `APP_PORT` (and the port in `APP_URL`).
- `BOOKORBIT_FIX_PERMISSIONS=true` auto-fixes ownership of the mounted `books`/`data` folders — so point `BOOKS_HOST_PATH` at a **dedicated** folder, not a shared library root.
- Migrating an existing calibre/AudioBookShelf library? BookOrbit has in-app import guides.

## Deploy Shelfarr (Portainer)
1. **Stacks → + Add stack** → name `shelfarr` → **Web editor** → paste `docker-compose.shelfarr.yml`.
2. In **Environment variables**, add the entries from [`.env.shelfarr.example`](.env.shelfarr.example) — point `EBOOKS_HOST_PATH` / `AUDIOBOOKS_HOST_PATH` at the **same folders** BookOrbit's library reads from.
3. **Deploy the stack**, then finish setup in the Shelfarr UI (see the steps at the bottom of `.env.shelfarr.example`): download client, Prowlarr, output paths, and Library Platform = BookOrbit.

## Deploy Shelfarr (CLI)
```bash
cp .env.shelfarr.example .env    # fill in paths
docker compose -f docker-compose.shelfarr.yml up -d
```

### Shelfarr gotcha
Redeploying/recreating the Shelfarr stack wipes its connection settings (download client,
indexer, library platform) — the admin account and library data survive. Avoid unnecessary
redeploys; if one happens, just redo the setup steps in the UI.
