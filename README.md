# CODE — Cimory Operational Digital Enhancement

Internal web platform for PT. Cisarua Mountain Dairy (CMD Plant Sentul) that centralises Power BI dashboards, manages user access, and serves as a department operation portal.

---

## Table of Contents

1. [Tech Stack](#tech-stack)
2. [Project Structure](#project-structure)
3. [Prerequisites](#prerequisites)
4. [Local Development Setup](#local-development-setup)
5. [Environment Variables](#environment-variables)
6. [Database Setup](#database-setup)
7. [Gmail SMTP Setup](#gmail-smtp-setup)
8. [Power BI Setup](#power-bi-setup)
9. [AI Dashboard Assistant (Gemini)](#ai-dashboard-assistant-gemini)
10. [Production Deployment](#production-deployment)
11. [Pushing to GitHub](#pushing-to-github)
12. [Default Admin Account](#default-admin-account)

---

## Tech Stack

| Layer    | Technology                              |
|----------|-----------------------------------------|
| Frontend | React 18, Vite, Tailwind CSS, Framer Motion |
| Backend  | Node.js, Express.js (ES Modules)        |
| Database | MySQL 8                                 |
| Auth     | JWT (jsonwebtoken)                      |
| Email    | Nodemailer + Gmail SMTP                 |
| BI       | Power BI Embedded (App Owns Data)       |
| AI       | Google Gemini (free tier) — dashboard Q&A |
| Uploads  | Multer (local disk storage)             |

---

## Project Structure

```
COD Project/
├── backend/
│   ├── migrations/          # SQL schema files — run once on first deploy
│   │   ├── cod_db.sql       # Base schema (users, dashboards, access_requests)
│   │   ├── add_portal_links.sql   # Additional tables added later
│   │   └── add_ai_assistant.sql   # AI assistant tables + dashboards.report_id
│   ├── knowledge/
│   │   └── powerbi-analyst/ # Domain knowledge pack for the AI (semantic models,
│   │                        # KPI statuses, acronyms, RCA framework)
│   ├── src/
│   │   ├── config/
│   │   │   ├── db.js        # MySQL connection
│   │   │   ├── config.js    # Reads DB + server config from env vars
│   │   │   ├── email.js     # Nodemailer templates + approval pages
│   │   │   ├── powerbi.js   # Power BI embed token generation
│   │   │   ├── gemini.js    # Gemini REST client (free-tier friendly)
│   │   │   └── secretBox.js # AES-256-GCM encryption for stored API keys
│   │   ├── controllers/     # Dashboard CRUD + AI controllers
│   │   ├── middleware/
│   │   │   └── auth.js      # verifyJWT
│   │   ├── models/          # DB models (dashboards, portal links, AI)
│   │   ├── services/        # AI prompt/context/knowledge builders
│   │   ├── routes/          # Express routers
│   │   └── server.js        # App entry point
│   ├── uploads/             # User-uploaded portal icons (git-ignored)
│   ├── .env                 # Secret config — never commit this
│   ├── .env.example         # Template for .env
│   └── package.json
├── frontend/
│   ├── public/
│   │   └── images/          # Static assets (Logo_Cimory.png, etc.)
│   ├── images/              # Hero background images
│   ├── src/
│   │   ├── api/api.js       # Axios base instance
│   │   ├── components/      # All React page components
│   │   └── App.jsx          # Routes, auth, embed logic
│   ├── .env                 # Optional frontend env (VITE_ prefix)
│   ├── vite.config.js       # Vite + dev proxy to backend
│   └── package.json
├── .gitignore               # Root-level ignores
└── README.md
```

---

## Prerequisites

Install these before anything else:

| Tool | Version | Download |
|------|---------|----------|
| Node.js | 18 LTS or 20 LTS | https://nodejs.org |
| npm | comes with Node.js | — |
| MySQL | 8.0+ | https://dev.mysql.com/downloads/ |
| Git | latest | https://git-scm.com |

> **Windows users:** MySQL Workbench is recommended for running the SQL migration files visually.

---

## Local Development Setup

### 1 — Clone the repository

```bash
git clone https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
cd "COD Project"
```

### 2 — Install dependencies

Open **two terminals** (one for backend, one for frontend):

```bash
# Terminal 1 — Backend
cd backend
npm install
```

```bash
# Terminal 2 — Frontend
cd frontend
npm install
```

### 3 — Configure environment variables

```bash
# Inside the backend/ folder
cp .env.example .env
```

Open `backend/.env` and fill in all values (see [Environment Variables](#environment-variables) section).

### 4 — Set up the database

See [Database Setup](#database-setup).

### 5 — Start both servers

```bash
# Terminal 1 — Backend (port comes from PORT in backend/.env)
cd backend
npm run dev
```

```bash
# Terminal 2 — Frontend (runs on http://localhost:5173)
cd frontend
npm run dev
```

Open your browser at **http://localhost:5173**.

> The Vite dev server proxies `/api` and `/uploads` to the backend — no CORS issues in development.
>
> **The proxy target must match `PORT` in `backend/.env`.** `vite.config.js` defaults to
> `http://localhost:5050`; if your backend listens elsewhere, set it without editing the config:
>
> ```bash
> # frontend/.env
> VITE_BACKEND_TARGET=http://localhost:5000
> ```
>
> Symptom of a mismatch: the UI shows *"error connecting with server"* while
> `curl http://localhost:<PORT>/` returns `Cimory Operation API Running ✅`.

---

## Environment Variables

Copy `backend/.env.example` to `backend/.env` and fill in each value:

### Server & Database

| Variable | Description | Example |
|----------|-------------|---------|
| `PORT` | Port the Express server listens on | `5000` |
| `DB_HOST` | MySQL host | `localhost` |
| `DB_USER` | MySQL username | `root` |
| `DB_PASSWORD` | MySQL password | `your_password` |
| `DB_NAME` | Database name | `central_of_digitalization` |
| `JWT_SECRET` | Secret key for signing JWTs — use a long random string | `a8f3...` |

### Power BI

| Variable | Description |
|----------|-------------|
| `POWERBI_TENANT_ID` | Azure Active Directory Tenant ID |
| `POWERBI_CLIENT_ID` | Azure App Registration Client ID |
| `POWERBI_CLIENT_SECRET` | Azure App Registration Client Secret |
| `POWERBI_MASTER_USERNAME` | Power BI master user email (used for embed token) |
| `POWERBI_MASTER_PASSWORD` | Power BI master user password |
| `POWERBI_WORKSPACE_ID` | Power BI Workspace (Group) ID |
| `POWERBI_REPORT_*` | Individual Report IDs for each embedded dashboard |

### Email & Notifications

| Variable | Description |
|----------|-------------|
| `EMAIL_FROM` | Gmail address used to send emails |
| `EMAIL_PASSWORD` | Gmail **App Password** (16 chars, no spaces) — not your regular Gmail password |
| `SUPERUSER_EMAIL` | Email that receives new user registration notifications |
| `BACKEND_URL` | Public URL of the backend server (used in email approval links) |

---

## Database Setup

### Step 1 — Create the database

Log in to MySQL and run:

```sql
CREATE DATABASE central_of_digitalization
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;
```

### Step 2 — Run the base schema

```bash
mysql -u root -p central_of_digitalization < backend/migrations/cod_db.sql
```

Or open `backend/migrations/cod_db.sql` in MySQL Workbench and execute it.

### Step 3 — Run the additional migrations

```bash
mysql -u root -p central_of_digitalization < backend/migrations/add_portal_links.sql
mysql -u root -p central_of_digitalization < backend/migrations/add_ai_assistant.sql
```

`add_portal_links.sql` adds the `portal_links` table, `user_dashboard_access` table, and two extra columns to existing tables.
`add_ai_assistant.sql` adds `dashboards.report_id` plus the `ai_user_keys` and `ai_chat_logs` tables used by the [AI Dashboard Assistant](#ai-dashboard-assistant-gemini).

> **Important:** Run Step 3 only **after** Step 2. Running it twice is safe — all statements use `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`.

---

## Gmail SMTP Setup

The email notification system uses Gmail with an **App Password** (required when 2-Step Verification is enabled on your Google account).

1. Go to your Google Account → **Security** → **2-Step Verification** → enable it if not already on.
2. Go to **Security** → **App passwords** (search "App passwords" in the search bar).
3. Select app: **Mail** / device: **Other** → enter a name like "CODE Platform".
4. Copy the generated **16-character password** (no spaces).
5. Paste it as `EMAIL_PASSWORD` in your `.env` file.

> Do **not** use your regular Gmail password — it will not work.

---

## Power BI Setup

The platform uses the **App Owns Data** embedding model with a master user account.

1. In **Azure Portal** → App Registrations → create or use an existing app.
2. Note down **Tenant ID**, **Client ID**, and generate a **Client Secret**.
3. In **Power BI Admin Portal** → Tenant Settings → enable *Allow service principals to use Power BI APIs*.
4. In your **Power BI Workspace** → Settings → add the service principal as a **Member**.
5. Find your **Workspace ID** from the URL: `app.powerbi.com/groups/{WORKSPACE_ID}/...`
6. Find each **Report ID** from the report URL: `app.powerbi.com/groups/.../reports/{REPORT_ID}/...`
7. Fill in all `POWERBI_*` variables in `.env`.

---

## AI Dashboard Assistant (Gemini)

Users can ask questions in natural language about any embedded dashboard, and get
answers computed from the **actual numbers currently rendered on screen** —
including whatever slicers/filters they have applied.

### How it works

```
Embedded report (embed token)
   └─ visual.exportData(Summarized)   ← frontend/src/utils/powerbiData.js
        → snapshot { pagesRead, filters, slicers, visuals[{page, columns, rows}] }
             └─ POST /api/ai/ask   (JWT + dashboard access re-checked server-side)
                  ├─ data snapshot         → services/aiContext.js
                  ├─ domain knowledge      → services/aiKnowledge.js
                  └─ Gemini generateContent → config/gemini.js
                       → grounded natural-language answer
```

No DAX is generated and no dataset credentials are exposed — the AI only ever sees
the same aggregated numbers the user can already see and export.

### Which pages the AI reads

By default only the page the user is looking at, which keeps the snapshot small and
the answer unambiguous. The panel has a **Halaman** picker (visible when the report
has more than one page) to include any combination of pages, or all of them.

Reading other pages is not merely a bigger loop:

- **Power BI may refuse `exportData` for a page it has never rendered.** When a whole
  page comes back empty, that page is briefly activated, re-exported, and the user's
  original page is restored — with progress shown in the panel. Set
  `activateIfNeeded: false` to opt out and surface the failures instead.
- **Visual descriptors are re-fetched after activation**, because the pre-activation
  descriptors are stale.
- **The prompt states which pages are in the snapshot and which are not**, so a
  question about an excluded page gets "that page isn't loaded, tick it and press
  Refresh" instead of an invented number.
- Cross-page reasoning works: asking for the most failure-prone machine *and* its
  MTTR correctly joins a table on one page with a table on another, and reports
  "no MTTR shown for this machine" where the join has no match.

Cost of breadth: more pages means a slower capture, a larger prompt, and more
free-tier quota per question — hence the per-page opt-in rather than all-pages by
default.

### Requirements per dashboard

The dashboard must have a valid **Report ID** — the report GUID — in Dashboard
Manager → *Report ID (Export Mode & Ask AI)*. Public `view?r=...` iframes cannot be
scripted by the browser, so "Ask AI" only appears when a real GUID is present (same
requirement as Export Mode).

**A `view?r=...` share link is not a Report ID and cannot be converted into one.**
The base64 token inside it decodes to `{"k": "<share-key>", "t": "<tenant>"}` and
that `k` is a share key, not the report ID — verified on this workspace, where the
Service Level report's key (`89ca7919-…`) differs from its actual report ID
(`60f4984e-…`). Pasting such a link used to produce a confusing `404` on
`/api/powerbi/embed-config-by-report/...` because the slashes in the URL broke route
matching; it is now rejected up front with an explanatory message, and the
Dashboard Manager shows ✅ / ⚠️ / ❌ per row plus live validation on the form.

Where to find the GUID:

```
https://app.powerbi.com/groups/<workspace>/reports/<REPORT_GUID>/ReportSection...
                                                  ^^^^^^^^^^^^^
```

A full `reportEmbed?reportId=<GUID>&...` URL is also accepted — the GUID is
extracted automatically.

### API keys

Two options, checked in this order:

1. **Personal key (BYOK)** — each user saves their own free key via the ✨ icon in
   the header (*Pengaturan CODE AI*). Stored AES-256-GCM encrypted in
   `ai_user_keys`, with the key derived from `JWT_SECRET`.
2. **Universal key** — `CODE_AI_UNIVERSAL_KEY` in `backend/.env` (legacy name
   `GEMINI_API_KEY` still works), used only when a user has no key of their own.

**BYOK is preferred deliberately.** Free-tier quota belongs to the *key*, not the
person: everyone on the universal key competes for a single pool. The quota
indicator therefore scopes its counting to whichever key will be charged —
per-user for BYOK, across *all* users for the universal key. Without that,
fifty people would each be told they have 500 requests left when the shared key
only has 500 in total. Users on the universal key see a note saying so.

Get a free key at <https://aistudio.google.com/apikey>. Free-tier limits apply per
key, which is why per-user keys are supported — heavy users don't drain the shared
quota. A per-user rate limit (`AI_RATE_MAX_REQUESTS` / `AI_RATE_WINDOW_SECONDS`)
protects the shared key.

### CODE AI Navigator (home screen)

A second, much cheaper assistant lives behind the floating button on the
dashboard list, above the scroll-to-top control. It answers *"which dashboard do
I need?"* — and deliberately **cannot read dashboard data at all**.

It sees only the catalogue: title, department, description, and whether *this*
user may open each dashboard. That makes it ~2,200 prompt tokens for all 44
dashboards, so it runs on the fast tier and barely touches the daily allowance.

The reply is structured JSON, rendered as interactive cards:

| User has access | Buttons shown |
|---|---|
| yes, and the dashboard has a Report GUID | **Buka dashboard** · **Analisa** (opens it with the CODE AI panel already expanded) |
| yes, no Report GUID | **Buka dashboard** |
| no | **Minta akses dulu** (fires the existing access-request flow) |

Dashboard ids that the model invents are dropped server-side — only ids present
in the catalogue become buttons. The access flag is computed from
`user_dashboard_access`, never from the model's opinion, so it can never point
someone at something they may not open without saying so.

Beyond finding dashboards it also answers glossary questions ("apa itu MTBF?")
from the confirmed rows of `kpi-dictionary.md`, and refuses number questions by
directing the user into the dashboard's own CODE AI panel.

### Model selection

Google retires models, and a retired model returns `404 "no longer available to new
users"` — which looks like an app bug but is not. `ALLOWED_MODELS` in
`config/gemini.js` therefore lists only models verified callable on a fresh
free-tier key, so the dropdown can never offer a dead option. Measured 2026-07-31:

| Model | Result | Latency | Free-tier RPM / RPD |
|---|---|---|---|
| `gemini-3.6-flash` | works, best reasoning | ~2.6 s | 5 / **20** |
| `gemini-3.5-flash` | works | ~2.2 s | 5 / **20** |
| `gemini-3.5-flash-lite` | works, no thinking tokens | ~0.9 s | 15 / 500 |
| `gemini-3.1-flash-lite` | works | ~1.3 s | 15 / 500 |
| `gemini-2.5-flash` / `-lite` | **404 retired** | — | — |
| `gemini-2.0-flash` | **429**, no free-tier quota | — | — |

Tiers are mapped with those limits in mind, not by quality alone: **Cepat** and
**Standar** use two *different* lite models so their 500/day allowances add up to
1000, leaving the scarce 20/day flash quota entirely to **Mendalam**. There is no
daily token cap on this tier — the token limit is per minute (250K), which one
user cannot realistically reach, so RPD is the binding constraint.

Thinking controls differ per generation and are handled automatically:
Gemini 3.x uses `thinkingConfig.thinkingLevel` (`low` by default —
measurably better *and* cheaper than leaving it unset), Gemini 2.5 uses
`thinkingConfig.thinkingBudget`. `maxOutputTokens` must cover thinking tokens too,
hence the 4096 default.

When Google retires the current default, re-check what a fresh key can call:

```bash
curl -s -H "x-goog-api-key: $GEMINI_API_KEY" \
  "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200" \
  | grep '"name"'
```

Note that ListModels still lists retired models — only an actual
`generateContent` call proves a model is usable.

### Data sanitization

**Read this before enabling AI on confidential dashboards.**

On the Gemini API **free tier**, Google may use prompt content to improve their
products. Paid tiers and Vertex AI do not carry that term. Sanitization here is
defence-in-depth, **not** a substitute for a paid key: the operational figures are
the analysis, so they must be sent. What is removed is **identity**.

Everything crossing the boundary passes through `services/aiSanitizer.js`:

| Treatment | Applies to | Result |
|---|---|---|
| **Pseudonymized** (reversible) | people (`Dim_Karyawan`, operator, PIC, approver), trading partners (supplier, vendor, customer, peternak, koperasi), document numbers (PO/DO/PR/batch/serial) | model sees `ORANG_a1b2` / `MITRA_c3d4` / `DOK_e5f6`; the user reads the real name |
| **Dropped** (irreversible) | email, phone, NIK/KTP, NPWP, bank account, address; compensation (gaji, upah, tunjangan, insentif); health/injury (korban, cedera, LTI) | column removed, or value replaced with `[EMAIL]`, `[TELP]`, `[DISAMARKAN]` |
| **Scrubbed + capped** | free text (keterangan, catatan, root cause, saran, keluhan) | contacts removed, known names tokenized, truncated to 160 chars |
| **Relative only** (opt-in) | money columns, when `AI_SANITIZE_MONEY=relative` | `74.9%` share of column total instead of `12.500.000` |
| **Untouched** | machines, lines, shifts, dates, categories, products, operational numbers | needed for the answer to be useful |

Tokens are `HMAC-SHA256(value, JWT_SECRET)` truncated — so the same value always
maps to the same token without storing a lookup table, and the model can still
group, rank and compare entities. The answer is de-tokenized before it reaches the
user or the `ai_chat_logs` table, and stored history is re-tokenized on the way back
out so a follow-up question doesn't leak what the first one hid.

Two details worth knowing:

- **Entities are registered in a first pass over all visuals**, so a supplier named
  only in visual 5 is still masked inside visual 1's notes column.
- **The knowledge pack is scrubbed too.** An audit of
  `knowledge/powerbi-analyst/` found three things that were being sent on every
  request: the **Azure tenant GUID** (registry header), **named suppliers**
  (`Supplier AJI`, `Supplier Bangun Lestari` in `SKILL.md`), and **hardcoded product
  spec bands** (`% TS 16,01 - 16,3`, `Standar CMD 1 (51)`). GUIDs and spec numbers
  are now redacted, supplier names pseudonymized. Set
  `AI_SEND_DOMAIN_KNOWLEDGE=false` to withhold the pack entirely.

What sanitization **cannot** do: hide the shape of the data itself. Volumes,
downtime hours, cost totals, and QC measurements are sent because they are the
question. Dashboards where those figures are themselves the secret — the Pyschem /
PQR product-spec reports and the GL/finance models are the obvious candidates in
this workspace — should use a paid key, or have Ask AI kept off by leaving their
Report ID blank.

The panel footer under each answer shows how many values were masked
(`🛡 12 nilai disamarkan`), and AI Settings explains the current policy to users.

### Domain knowledge pack

`backend/knowledge/powerbi-analyst/` holds the `powerbi-enterprise-analyst`
knowledge base — a structural sweep of the `CMD - Plant Sentul` workspace:
semantic model inventory, KPI confirmation status, acronym collisions (PM =
Packaging Material vs Preventive Maintenance, DT = Downtime vs Digital
Transformation), the RCA framework, and the executive answer template.

`services/aiKnowledge.js` injects only the relevant slices per question:

| Injected | When |
|---|---|
| Matched semantic model entry | dashboard title maps to a registry model (alias map + token matching) |
| KPI status rows | KPI names match the model or the question |
| Acronym + naming legend | always |
| RCA framework | question contains why / kenapa / naik / turun / downtime / loss / … |
| Executive answer template | always |

To register a new dashboard → model mapping, add an entry to `MODEL_ALIASES` in
`services/aiKnowledge.js`. To refresh the knowledge itself, replace the markdown
files in `backend/knowledge/powerbi-analyst/`.

### Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET    | `/api/ai/status` | Is AI enabled, which key/model is active |
| PUT    | `/api/ai/key` | Save + validate the user's own Gemini key |
| DELETE | `/api/ai/key` | Remove it (falls back to server key) |
| PUT    | `/api/ai/model` | Change preferred model |
| POST   | `/api/ai/ask` | Ask a question about a dashboard snapshot |
| GET    | `/api/ai/history/:dashboardId` | Previous Q&A for this user + dashboard |
| DELETE | `/api/ai/history/:dashboardId` | Clear that history |

All require a valid JWT. `/api/ai/ask` re-verifies dashboard access server-side, so
a user cannot ask about a dashboard they have no access to.

Every question and answer is logged in `ai_chat_logs` (model, key source, visual
and row counts, errors) — this doubles as the chat memory and the rate-limit
counter.

### Migration

```bash
mysql -u root -p central_of_digitalization < backend/migrations/add_ai_assistant.sql
```

### Limits and failure modes

| Situation | Behaviour |
|---|---|
| Dashboard has no Report ID | "Ask AI" button is hidden — nothing to query |
| A visual cannot be exported (e.g. custom/ESRI visual) | That visual is reported to the AI as unavailable rather than silently dropped |
| Table/matrix bigger than the row cap | 500 rows (2 000 in Deep mode) are sent, and the answer is told the data is partial |
| User changes a slicer or page after the snapshot | Refresh button turns amber — the AI is never fed stale numbers unknowingly |
| Question is about a page not included in the snapshot | The AI says so and names the page to tick, instead of guessing |
| A whole page refuses to export | It is activated briefly, re-read, and the original page restored |
| No Gemini key configured | `503` with instructions to set one |
| Free-tier quota exhausted | `429` from Google, surfaced verbatim to the user |
| More than 10 questions per minute per user | `429` from an in-memory sliding-window limiter (independent of chat history, so clearing history does not reset it) |

### Testing checklist (UI)

1. Log in → header shows a ✨ *AI Assistant Settings* icon.
2. Open it → paste a free Gemini key → **Save** (the key is verified against Google before it is stored).
3. Open any dashboard you have access to → **Ask AI** (card header or fullscreen top bar).
4. The blue bar should report *N visual · M baris* once the report finishes rendering.
5. Ask e.g. *"mesin mana yang downtime-nya paling tinggi?"* — the answer must cite numbers that exist on screen.
6. Change a slicer → the Refresh button turns amber → click it → ask again and confirm the numbers follow the new filter.
7. Ask something not on the page (e.g. about another month) → the AI should say the data is not in this view instead of inventing it.
8. Open **Halaman: 1/N** → tick another page → **Baca N halaman** → ask a question that needs both pages, and confirm the answer cites figures from each.

---

## Production Deployment

The recommended stack for a Linux VPS (Ubuntu 22.04):

### 1 — Install server dependencies

```bash
# Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# PM2 — process manager for the backend
sudo npm install -g pm2

# Nginx — web server for the frontend + reverse proxy
sudo apt-get install -y nginx

# MySQL 8
sudo apt-get install -y mysql-server
sudo mysql_secure_installation
```

### 2 — Upload the project

```bash
# On your local machine — push to GitHub (see next section)
# On the server — clone the repo
git clone https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git /var/www/cod-project
cd /var/www/cod-project
```

### 3 — Configure environment

```bash
cd backend
cp .env.example .env
nano .env   # fill in all production values
# Set BACKEND_URL=https://api.yourdomain.com  (or http://SERVER_IP:5000)
```

### 4 — Install dependencies & set up the database

```bash
# Backend
cd /var/www/cod-project/backend
npm install --omit=dev

# Database
mysql -u root -p -e "CREATE DATABASE central_of_digitalization CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"
mysql -u root -p central_of_digitalization < migrations/cod_db.sql
mysql -u root -p central_of_digitalization < migrations/add_portal_links.sql
```

### 5 — Build the frontend

```bash
cd /var/www/cod-project/frontend
npm install
npm run build
# Output is in frontend/dist/
```

### 6 — Start the backend with PM2

```bash
cd /var/www/cod-project/backend
pm2 start src/server.js --name "cod-backend"
pm2 save
pm2 startup   # follow the printed command to auto-start on reboot
```

Verify it is running:

```bash
pm2 status
pm2 logs cod-backend
```

### 7 — Configure Nginx

Create `/etc/nginx/sites-available/cod`:

```nginx
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;

    # Serve the built React frontend
    root /var/www/cod-project/frontend/dist;
    index index.html;

    # Handle React Router — always serve index.html for unknown paths
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Proxy API requests to Express
    location /api/ {
        proxy_pass         http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
    }

    # Proxy uploaded images
    location /uploads/ {
        proxy_pass         http://localhost:5000;
        proxy_http_version 1.1;
    }
}
```

Enable the site and reload:

```bash
sudo ln -s /etc/nginx/sites-available/cod /etc/nginx/sites-enabled/
sudo nginx -t          # test config
sudo systemctl reload nginx
```

### 8 — (Optional) Enable HTTPS with Let's Encrypt

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

Certbot will auto-update the Nginx config with SSL. It auto-renews every 90 days.

> After enabling HTTPS, update `BACKEND_URL=https://api.yourdomain.com` in `.env` and restart PM2:
> ```bash
> pm2 restart cod-backend
> ```

---

## Pushing to GitHub

### First time — initialise and push

```bash
# From the project root (COD Project/)
git init
git add .
git commit -m "Initial commit: CODE platform"

# Create a new repo on GitHub, then:
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
git branch -M main
git push -u origin main
```

### Subsequent updates

```bash
git add .
git commit -m "describe what you changed"
git push
```

### Verify nothing sensitive is committed

Before your first push, run this to confirm `.env` files are not tracked:

```bash
git status
# .env files should NOT appear in the list
```

If a `.env` file appears, run:

```bash
git rm --cached backend/.env
git commit -m "remove .env from tracking"
```

---

## Default Admin Account

The admin functions (Dashboard Manager, Portal Link Manager, User Management) are available to the account with username `digital.transformation`.

Create this account manually in MySQL after the first migration:

```sql
-- Replace the password hash with a bcrypt hash of your chosen password
-- You can generate one at: https://bcrypt-generator.com (rounds: 10)

INSERT INTO users (nama, departemen, tipe_akses, nik, email, username, password, approved)
VALUES (
  'Digital Transformer',
  'Digital Transformation',
  'admin',
  '000000',
  'your_admin_email@cimory.com',
  'digital.transformation',
  '$2b$10$YOUR_BCRYPT_HASH_HERE',
  1
);
```

---

## Maintenance

### View backend logs
```bash
pm2 logs cod-backend
```

### Restart backend after code changes
```bash
cd /var/www/cod-project/backend
git pull
pm2 restart cod-backend
```

### Redeploy frontend after code changes
```bash
cd /var/www/cod-project/frontend
git pull
npm run build
# Nginx serves the new dist/ automatically — no restart needed
```
