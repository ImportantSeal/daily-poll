# Päivän kysymys (A/B) — 0EUR/kk MVP

Staattinen React-sivu (GitHub Pages) + Cloudflare Worker API + D1 (SQLite) datalle.

## Arkkitehtuuri
- `apps/web`: Vite + React + TypeScript käyttöliittymä GitHub Pagesiin.
- `apps/api`: Cloudflare Worker (TypeScript), CORS, dedupe, validointi.
- `packages/shared`: jaetut TypeScript-tyypit frontendille ja backendille.
- `apps/api/migrations`: D1 SQL -migraatiot + seed-data.

## Repo-rakenne
```txt
.
|- apps/
|  |- api/
|  |  |- migrations/
|  |  |- src/index.ts
|  |  `- wrangler.toml
|  `- web/
|     |- src/
|     `- vite.config.ts
|- packages/
|  `- shared/src/index.ts
`- .github/workflows/deploy-pages.yml
```

## API endpointit
- `GET /api/question/today`
- `POST /api/vote` body: `{ "questionId": "...", "choice": "A" | "B" }`
- `GET /api/results?questionId=<id>`

## Tietoturva ja yksityisyys
- IP-osoitetta ei tallenneta tietokantaan.
- Dedupe-avain = `sha256(ip + ua + questionId + dailySalt)`.
- `dailySalt` vaihtuu päivittäin (`YYYY-MM-DD` Helsinki + `SECRET_SALT`), joten pysyvää seurantaa päivien yli ei synny.
- Segmentit MVP: `all`, `country:XX`, `device:mobile|desktop`.

## 1) Asennus
Vaatimukset:
- Node.js 20+
- npm 10+
- Cloudflare-tili + Wrangler CLI (`npx wrangler ...`)

Asenna riippuvuudet:
```bash
npm install
```
Jos saat Windowsissa `EISDIR ... symlink`-virheen, ota Developer Mode käyttöön tai aja terminaali järjestelmänvalvojana.

## 2) Cloudflare D1 setup
Luo D1-tietokanta:
```bash
npx wrangler d1 create daily-question-db
```

Kopioi komennon antama `database_id` tiedostoon `apps/api/wrangler.toml` kenttään `database_id`.

Migraatiot (remote):
```bash
npm --prefix apps/api run d1:migrate:remote
```

Paikallinen migraatio:
```bash
npm --prefix apps/api run d1:migrate:local
```

Seed-data on migraatiossa `apps/api/migrations/0002_seed_questions.sql` (sis. päivän `2026-03-05`).

## 3) Worker config + deploy
Aseta salaisuus:
```bash
npx wrangler secret put SECRET_SALT
```
Paikallista ajoa varten voit kopioida `apps/api/.dev.vars.example` -> `apps/api/.dev.vars`.

Aseta sallittu origin tiedostossa `apps/api/wrangler.toml`:
```toml
[vars]
ALLOWED_ORIGIN = "https://<username>.github.io"
```

Deploy:
```bash
npm --prefix apps/api run deploy
```

Worker URL on muotoa:
`https://<worker-name>.<subdomain>.workers.dev`

## 4) Web app local dev
Luo tiedosto `apps/web/.env.local`:
```bash
VITE_API_BASE_URL=http://127.0.0.1:8787
```
Voit kopioida pohjan tiedostosta `apps/web/.env.example`.

Käynnistä API:
```bash
npm run dev:api
```

Käynnistä web:
```bash
npm run dev:web
```

## 5) GitHub Pages deploy
Workflow: `.github/workflows/deploy-pages.yml`.

Aseta GitHub-repon muuttuja:
- `VITE_API_BASE_URL = https://<worker>.workers.dev`

Sitten:
1. GitHub repo settings -> Pages -> Source: GitHub Actions
2. Push `main`-haaraan
3. Workflow buildaa `apps/web/dist` ja julkaisee Pagesiin

`VITE_BASE_PATH` asetetaan workflowssa automaattisesti muotoon `/<repo-name>/`.

## 6) CORS
API sallii vain originin, joka vastaa `ALLOWED_ORIGIN`-arvoa.
Preflight (`OPTIONS`) vastataan vain sallitulle originille.

## 7) MVP laajennettavuus
MVP on pidetty tarkoituksella pienenä, mutta rakenne tukee jatkokehitystä:
- `questions.tags` valmiina kategorioille
- segmenttimekanismi tukee helposti esim. `ref:twitter` / `utm_source`
- tulosten kyselyä voi laajentaa usean päivän raportointiin
