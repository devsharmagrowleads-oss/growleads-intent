# Growleads Intent

Signal-based outbound lead generation, run entirely from the command line.

It mines the LinkedIn engagement around "seed" people — competitors, influencers,
creators your buyers already follow — qualifies every engager against an ICP, and
exports a campaign-ready prospect list.

No server, no dashboard, no API. Everything runs through `pipeline/cli.js`.

---

## Quick start

```bash
git clone https://github.com/devsharmagrowleads-oss/growleads-intent.git
cd growleads-intent/pipeline

npm install                 # 2 deps: axios, dotenv
cp .env.example .env        # then paste your RapidAPI key in

node cli.js status          # creates an empty database on first run
```

The schema builds itself on first run, so the CLI works immediately — against an
empty database.

---

## Getting the dataset

**The database is deliberately not in this repo.** It holds profile data on
thousands of real people, so it is never committed, in any form — not the live
file, not a compressed snapshot. `pipeline/data/` is fully gitignored.

To work with the real dataset, get `growleads.db.gz` from whoever runs the
pipeline (shared drive, direct transfer — not a git remote), then:

```bash
mkdir -p pipeline/data/snapshot
cp /path/to/growleads.db.gz pipeline/data/snapshot/
cd pipeline && npm run db:restore
```

That restores the full working set, including the `scraped_profiles` cache —
which is what lets you replay engagers at **0 RapidAPI credits**. The cache has a
30-day TTL; past it, profiles re-scrape and cost credits.

Without it you start empty: add seeds and scrape, and the database fills up as
you go.

### Handle it carefully

Everything in that database describes real, identifiable people. Keep it off
public remotes, out of shared buckets and away from anything indexable, and
honour deletion requests at the source.

---

## The loop

```
seeds add …  →  scrape  →  qualify export  →  (review)  →  qualify import  →  export
```

```bash
node cli.js seeds add <linkedin-url>     # add a seed to mine
node cli.js seeds list
node cli.js scrape [--force] [--no-cache]  # mine engagers → pending leads
node cli.js qualify export [file]        # write pending leads out for review
node cli.js qualify import <file>        # apply KEEP/REJECT verdicts
node cli.js export [file]                # CSV of qualified leads
node cli.js campaign [use <file>]        # show / switch active campaign
```

### Lead lifecycle

```
scrape   →  deterministic gates  →  qualification_status = 'pending'
qualify  →  ICP judgment         →  'qualified' | disqualified
export   →  CSV of qualified leads only
```

The deterministic gates (`services/filter.js`, `services/leadMagnet.js`) catch IC
titles, sales-tech vendors, competitors and lead-magnet giveaway comments.
Everything surviving is `pending` — a real person to judge on business model,
company size and industry against your own written ICP.

---

## Layout

```
docs/
  ICP.md                  ← the machine gate spec (how the code filters)
  SCRAPING_API.md         ← LinkedIn endpoint + response-shape reference
output/                   ← exported prospect lists land here (gitignored)
Campaigns/                ← campaign config, parsed by services/campaign.js; start from example_campaign.md

pipeline/
  cli.js                  ← the only entry point
  core/pipeline.js        ← seed → posts → engagers → pending leads
  services/
    linkedin.js           ← RapidAPI scraper (the only external data source)
    filter.js             ← ICP gates + disqualifiers
    leadMagnet.js         ← giveaway-comment / giveaway-post filter
    signals.js scorer.js  ← intent signals + composite score
    personalizer.js       ← outreach message builder
    companyEnrichment.js  ← company data → headcount size gate
  models/
    db.js                 ← Mongoose-style shim over local SQLite
  data/                   ← the entire database, one local file (all gitignored)
    growleads.db
    snapshot/             ← snapshots for out-of-band transfer
  scripts/
    db-restore.js         ← snapshot  → database
    db-snapshot.js        ← database → snapshot
```

---

## The database

One local SQLite file at `pipeline/data/growleads.db`, on Node's built-in
`node:sqlite` — no server, no cloud, no external dependency. `models/db.js` is a
hand-rolled shim that presents a Mongoose/Postgres-style API over it, so the
calling code reads as if it were talking to Mongo.

To reset completely: delete the file and re-run — `initDb()` rebuilds the schema.

### Producing a snapshot to hand off

```bash
npm run db:snapshot     # data/growleads.db → data/snapshot/growleads.db.gz
```

`VACUUM INTO` folds in the WAL and drops free pages first, so you get a clean,
compact copy rather than a torn read of a live file — roughly 143 MB down to
33 MB. The output is gitignored by design: move it out-of-band.

---

## Environment

Everything lives in `pipeline/.env` — see `.env.example` for the annotated list.

| Variable | Needed | Purpose |
|---|---|---|
| `RAPIDAPI_KEY` / `RAPIDAPI_HOST` | **required** | LinkedIn scraper |
| `RAPIDAPI_*_URL` | optional | per-endpoint overrides |
| `RAPIDAPI_COMPANIES_URL` / `RAPIDAPI_BULK_KEY` | optional | bulk company enrichment → size gate |
| `OPENAI_API_KEY` | optional | enables the `directIntent` AI stage; falls back to regex without it |
| `SQLITE_PATH` | optional | move the database elsewhere |

No database credentials — SQLite is a local file. (`DATABASE_URL`, if you see it
in an old `.env`, is dead and unused.)

---

## Operating notes

- The scraper is globally throttled to **1 request / 1.3s**. Respect it.
- **Company cap:** max 2 leads per company. **Cooldown:** 30 days before
  re-scraping a person.
- Seeds are mining sites, never prospects. Vendors and competitors discovered
  mid-scrape can be auto-promoted to seeds — watch that the seed list does not
  quietly regrow.
- The dataset describes real people. Keep exports and the database out of public
  places, and honour deletion requests at the source. Never commit exports,
  backups or the database to any repo.

---

## Licence

Released under the [MIT licence](LICENSE).
