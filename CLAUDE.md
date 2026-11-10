# Growleads — Claude Code Instructions

## What this is

A signal-based outbound lead-gen tool, run entirely from the **command line**.
It mines the LinkedIn engagement around "seed" people (competitors, influencers),
qualifies each engager against an ICP, and exports a campaign-ready prospect list.

There is **no server, no dashboard, no API**. Everything runs through `pipeline/cli.js`.
Final lead qualification is done by Claude (the CLI), not an external AI API.

## Run it

```bash
cd pipeline && npm install

node cli.js status                       # counts + active campaign
node cli.js seeds add <linkedin-url>     # add a seed to mine
node cli.js seeds list
node cli.js scrape [--force] [--no-cache]  # mine engagers → PENDING leads
node cli.js qualify export [file]        # write pending leads for review
node cli.js qualify import <file>        # apply KEEP/REJECT verdicts
node cli.js export [file]                # write CSV of QUALIFIED leads
node cli.js campaign [use <file>]        # show / switch active campaign
```

Typical loop: `seeds add …` → `scrape` → `qualify export` → (Claude reviews the
CSV against the written ICP, fills the `verdict` column) → `qualify import` →
`export`.

## Lead lifecycle

```
scrape  →  deterministic gates  →  qualification_status = 'pending'
qualify →  Claude/ICP judgment  →  'qualified' (kept) | disqualified (rejected)
export  →  CSV of qualified leads only
```

The deterministic gates (in `services/filter.js` + `services/leadMagnet.js`) catch
IC titles, sales-tech vendors, competitors, and lead-magnet giveaway comments.
Everything that survives is `pending` — a real person for Claude to judge on
business model, company size, and industry, using the written ICP as the spec.

## Structure

```
CLAUDE.md                 ← this file
Campaigns/                ← campaign config files (parsed by services/campaign.js)
  example_campaign.md
docs/
  ICP.md                  ← the machine gate spec (how the code filters)
output/
  growleads_campaign_ready.csv  ← exported prospect lists land here

pipeline/                 ← the CLI tool
  cli.js                  ← the command tool (the only entry point)
  core/pipeline.js        ← the enrichment brain: seed → posts → engagers → pending leads
  services/               ← business logic
    linkedin.js           ← RapidAPI scraper (the only external data source)
    filter.js             ← ICP gates + disqualifiers (IC titles, vendors, …)
    leadMagnet.js         ← deterministic giveaway-comment / giveaway-post filter
    signals.js scorer.js  ← intent signals (S03/S04/S08) + composite score
    personalizer.js       ← outreach message builder
    campaign.js           ← campaign-markdown parser
    companyEnrichment.js  ← RapidAPI company data (headcount → size gate)
    directIntent.js seedScorer.js pipelineCap.js logger.js
  models/                 ← local SQLite tables via a Mongoose-style shim (db.js)
  data/growleads.db       ← the entire database, one local file (gitignored)
  package.json            ← 2 deps: axios, dotenv
```

## Key facts

- **Database is local SQLite** — a single file at `pipeline/data/growleads.db`,
  using Node's built-in `node:sqlite` (zero external dependency, no server, no
  cloud). `models/db.js` is a hand-rolled Mongoose-compatible shim over it — the
  API looks like Mongo, the store is a local file. `initDb()` creates the full
  schema on first run. To reset: delete `data/growleads.db` and re-run.
- **The scraper is the only external API** (RapidAPI LinkedIn — see the RapidAPI
  wrapper in `services/linkedin.js`). It is globally throttled to 1 request / 1.3s.
- **No OpenAI.** Qualification is the Claude/CLI pass. `directIntent.js` will use
  an OpenAI key if present but falls back to regex without one.
- **30-day profile cache** in `scraped_profiles` — re-runs replay engagers at 0 credits.
- **Company cap:** max 2 leads per company. **Cooldown:** 30 days before re-scraping a person.
- Seeds are never sold to; they are mining sites. Vendors/competitors found while
  scraping are auto-promoted to seeds.

## Environment (pipeline/.env)

- *(no database env needed — SQLite is a local file. `SQLITE_PATH` optionally
  overrides its location; `DATABASE_URL` in `.env` is now unused/dead.)*
- `RAPIDAPI_KEY`, `RAPIDAPI_HOST` — LinkedIn scraper (required)
- `RAPIDAPI_*_URL` — per-endpoint overrides (see `services/linkedin.js`)
- `OPENAI_API_KEY` — optional; only enables the directIntent AI stage
