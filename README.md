# kindlebookstack — BookOrbit

Self-hosted **BookOrbit**: one app for **ebooks, PDFs, comics, and audiobooks**, with a web
reader, **KOReader/Kobo sync**, **OPDS**, and **Send-to-Kindle** — a single replacement for
calibre-web + AudioBookShelf. Ships with its own PostgreSQL (pgvector).

## Deploy (Portainer)
1. **Stacks → + Add stack** → name `bookorbit` → **Web editor** → paste `docker-compose.yml`.
2. In **Environment variables**, add the entries from [`.env.example`](.env.example) with your real values:
   - Generate secrets: `openssl rand -hex 32` for `JWT_SECRET` and `SETUP_BOOTSTRAP_TOKEN`; a strong `POSTGRES_PASSWORD`.
   - Set `APP_URL` to how you reach it, e.g. `http://192.168.1.56:3000`.
   - Set the host paths (`BOOKS_HOST_PATH`, `APP_DATA_HOST_PATH`, `DB_DATA_HOST_PATH`).
3. **Deploy the stack.**

## Deploy (CLI)
```bash
cp .env.example .env    # fill in secrets + paths
docker compose up -d
```

## First run
1. Open `http://HOST:3000` (give it a minute to init PostgreSQL).
2. Complete the **setup** screen — paste your `SETUP_BOOTSTRAP_TOKEN` when asked, then create your admin account.
3. Create a **Library** pointing at `/books`.

## Notes
- If port `3000` is taken, change `APP_PORT` (and the port in `APP_URL`).
- `BOOKORBIT_FIX_PERMISSIONS=true` auto-fixes ownership of the mounted `books`/`data` folders — so point `BOOKS_HOST_PATH` at a **dedicated** folder, not a shared library root.
- Pairs with **Shelfarr** (request + auto-download): set Shelfarr's Library Platform to BookOrbit and point its output paths into the BookOrbit library folder.
- Migrating an existing calibre/AudioBookShelf library? BookOrbit has in-app import guides.
