# Growleads — Ideal Customer Profile (ICP)

## What This Document Is

Growleads is a B2B lead-generation **agency**. We sell **done-for-you outbound services** — LinkedIn outreach, email outbound, AEO, GEO, Google Ads, LinkedIn authority building, and SEO — to B2B companies who **buy** outbound capability rather than build it in-house.

This document is the filter spec for the Growleads Intent pipeline. It defines:

1. **Who enters the Pipeline** — a person who engaged with one of our Seeds (a content creator whose audience contains our prospects) and who passes every gate.
2. **What priority each Pipeline lead gets** — based on persona bracket, company size, geography, hiring signals, and direct buying intent.
3. **What posts we even bother scraping** — a per-post AI relevance gate runs BEFORE we paginate reactions/comments, so we only spend engager-scraping credits on posts whose audience reads like buyers (not DIY-builders).

The spec is the source of truth. `Campaigns/example_campaign.md` is the per-campaign override layer that the parser reads (`pipeline/services/campaign.js`). The two are kept in sync.

### Three Categories We Care About

- **Seed** — a profile whose posts attract engagement from our prospects. We do NOT sell to Seeds. Quality requirement: a seed must have **≥15 own posts in the last 60 days** to qualify (a creator who posts less doesn't generate enough engagement signal).
- **Pipeline** — anyone who has shown interest in our services through Seed engagement and survived every gate. Priority differs per lead, but every Pipeline entry is worth contacting.
- **Buyer audience** — the people we actually want to reach. They are NOT the SDRs / sales managers / RevOps practitioners currently *running* outbound in-house — those are doing what we sell, in-house. They ARE the founders / executives / operators who feel outbound pain and would *buy* a done-for-you service.

### Seed Sourcing

- **Manual only.** Growleads runs on a hand-picked seed set. The `POST /seeds/:id/enrich/similar` route is disabled and returns `410 Gone`. Add seeds by hand via `POST /seeds`.
- **Seed quality gate** — `POST /seeds` returns `422` if the candidate's `engagement.ownPostCount < SEED_MIN_RECENT_POSTS` (default 15, configurable via env). Posts must be authored by the seed themselves (reshares don't count) and from the last 60 days.
- **Post window: last 20 posts, within the last 60 days.** Older posts are still on LinkedIn but their engagers are stale. Configured in `linkedin.js::getProfilePosts` defaults.

---

## Gate 0 — Pre-engager Filters (run before any profile fetch)

These two filters keep the pipeline efficient. They reject obvious noise before we burn LinkedIn API credits.

### Gate 0.1 — Post-relevance AI gate (runs once per post)

Before paginating reactions/comments on any seed post, the system asks GPT-4o-mini:

> Given the seed's role and this post's text, would engagers on this post likely be **buyers** of done-for-you outbound services?

**STRICT mode** — return YES only if the post discusses any of:
- **Sales tips, tricks, lessons, learnings** — cold outbound tactics, prospecting frameworks, what works in 2026, founder-led sales lessons
- **B2B / GTM / growth insight** — go-to-market strategy, why outbound is broken, pipeline diagnosis, AEO/GEO trends, market analysis
- **Founder pain & wisdom** — founder-led sales lessons, ICP discovery, runway pressure, early-stage GTM mistakes
- **Outbound channel commentary** — LinkedIn outreach reflections, email deliverability problems (as opinion/insight, NOT a tool plug)
- **Business leadership takeaways** — running a B2B company, common operator mistakes, scaling a software business
- **Pain expression / vendor frustration** — "we tried X and it failed", "spent $50k on outbound and got nothing" (strongest buyer-intent signal)
- **Market / industry analysis** for B2B verticals

**Return NO** when the post is:
- **Hiring / SDR-scaling / team-building** — "how to hire SDRs", "scaling our outbound team", "building a 12-person BDR org". Audience = DIY-builders, NOT buyers.
- **In-house playbooks** — "here's our cold call script", "our SDR cadence", "our weekly pipeline review". Audience = teams executing themselves.
- **Tool reviews / tool comparisons** — "Apollo vs Lemlist", "best outbound tools 2026". Audience = ops staff picking tools.
- **Personal** — anniversaries, birthdays, family moments, weather, travel selfies
- **Generic motivation / quotes** — "grind harder", inspirational image cards
- **Off-topic** — politics, sports, unrelated industries
- **Pure self-promotion**, memes, jokes, one-liners with no substance
- **Job hunting** / "open to work" posts
- **Conference / event check-ins** with no substantive content
- **Pure celebrations** — "we just hit $X ARR" with no operational learning

**Decision is cached on `posts_scraped`** in `relevance_decision` / `relevance_reason` / `relevance_judged_at`. Re-runs replay the cached verdict — 1 AI call ever per post (~$0.0002).

**Fail-open:** if the OpenAI call errors, post is treated as relevant. Better to over-scrape than miss leads silently.

Lives in `pipeline/services/aiQualifier.js::judgePostRelevance`. Wired into the post loop in `pipeline/routes/leads.js`.

### Gate 0.2 — Direct Intent fast-path (per engager-comment)

Before any gates run on an engager, the system inspects the **comment text** of each engagement (when the lead's interaction was a comment, not just a like) and attempts to detect direct buying / service-claiming intent.

**Detection pipeline (two stages):**

1. **Stage 1 — Regex scan** (free, runs first on every comment):
   ```
   /interested/i  /dm\s+me/i  /how\s+(do\s+i|to)\s+(sign\s*up|buy|get\s+started)/i
   /(pricing|cost|how\s+much|quote)/i
   /(we|i|our\s+team)\s+(need|want|are\s+looking\s+for)/i
   /(hiring|building)\s+(an\s+)?(outbound|sdr|gtm|growth|seo|agency|partner)/i
   /anyone\s+know\s+(a|an|good|reliable)/i  /reach\s+out/i
   /can\s+(you|we)\s+(help|chat|talk|connect)/i
   ```
2. **Stage 2 — AI classifier** (GPT-4o-mini). Runs only when Stage 1 hits an *ambiguous* pattern. Cost ≈ $0.001 per ambiguous comment.

**Outcome:**
- `directIntent = true` → the lead is fast-pathed: still must pass Gate 1, but **skips the legitimacy check in Gate 2** AND **forces Gate 3 priority to `top`** regardless of size / hiring / geography.
- `directIntent = false` → standard gates apply.

Lives in `pipeline/services/directIntent.js`.

---

## Disqualification Layer (runs before Gate 1)

Hard-rejects checked first in `filter.js::isDisqualified`. Short-circuit before any other gate.

### 0.A — Sales-tech / outbound / B2B-prospecting ecosystem vendors

Any company that sells **tools, data, or services TO outbound/sales teams** is a peer/competitor of Growleads, not a buyer. Hard-rejected regardless of headcount, geography, or persona bracket.

**Brand-name match** (substring in company name, headline, summary, description, title — word-bounded):

- **Data / enrichment / contact APIs:** FullEnrich, Clay, Apollo, Apollo.io, ZoomInfo, Lusha, Cognism, Hunter.io, RocketReach, Kaspr, Surfe, LeadIQ, Seamless.ai, Datagma, Findymail, Wiza, ContactOut, UpLead, Lead411, SignalHire, BetterContact, Prospeo, Persana, Bouncer, NeverBounce, ZeroBounce
- **Sales engagement / sequencer / senders:** Lemlist, Smartlead, Instantly, Salesloft, Outreach, Reply.io, Saleshandy, Mailshake, Woodpecker, QuickMail, Klenty, Mixmax, Yesware, Lavender, La Growth Machine, HeyReach, Expandi, Dripify, Salesflow, Closely
- **Lead-gen / intent / GTM intelligence:** Bombora, 6sense, Demandbase, Clearbit, Leadfeeder, Albacross, Visitor Queue, Warmly, RB2B, Trigify, Common Room, Champify, Pocus, UserGems, Crustdata, Predictleads, Coresignal

**Phrase match** (substring anywhere in profile text):
`"data aggregator"`, `"waterfall enrichment"`, `"email finder"`, `"phone finder"`, `"lead database"`, `"prospecting platform"`, `"outbound platform"`, `"cold email tool"`, `"cold-email sender"`, `"sales engagement platform"`, `"sales sequencer"`, `"b2b data provider"`, `"intent data provider"`

Lives in `filter.js::checkSalesTechVendor`.

### 0.B — Training / EdTech / coaching companies

Any company that sells **courses, certifications, bootcamps, or training programs** is a content seller, not a B2B SaaS buyer of outbound services. Hard-rejected regardless of operator-bracket title.

**Company-name match** (word-bounded substring in `currentCompany`):
`University`, `Universidad`, `Universidade`, `Université`, `Universität`, `Academy`, `Academia`, `Akademie`, `Institute`, `Instituto`, `Institut`, `School`, `Escuela`, `Escola`, `Schule`, `College`, `Colegio`, `Bootcamp`, `"Boot camp"`, `Mastermind`, `"Training Co/Company/Group/Inc/Ltd"`, `"Coaching Co/Company/Group/Inc/Ltd"`, `"EdTech Academy"`, `"Learning Lab"`

**Phrase match** (in headline/summary/companyDescription):
`"we sell courses"`, `"corporate training programs"`, `"executive education"`, `"professional certification"`, `"online learning platform"`, `"mba program"`, `"sales bootcamp"`, `"sales training program"`, `"paid community"`, `"paid mastermind"`, `"i help reps"`, `"i help sellers"`, `"cohort-based course"`, `"sells courses"`, `"sells training"`

Real-world catches: Live University, Latin America Institute of Business, Khan Academy, Stanford University, General Assembly Bootcamp.

Lives in `filter.js::checkTrainingVendor`.

### 0.C — Individual contributor (IC) titles

Title-based short-circuit before persona-bracket matching. Catches: `specialist`, `coordinator`, `associate`, `analyst`, `junior`, `intern`, `trainee`, `assistant`, `apprentice`, `account executive`, `account manager`, `account director`, `sales executive`, `sales development representative`, `sdr`, `bdr`, `customer service`, `customer support`, `appointment setter`, `prospector`, `outbound specialist`, `demand gen specialist`, `lead gen specialist`, `growth specialist`.

**Senior override:** if the title also contains a strong senior marker (founder/co-founder/ceo/cto/cpo/coo/cfo/cmo/cro/chief/owner/managing partner/managing director/president/head of/vp/svp/evp/director of), the senior marker wins.

Lives in `filter.js::isIndividualContributorTitle`.

### 0.D — Solo founder (1-employee "companies")

If `companyEmployeeCount === 1` AND the title is Founder / CEO / Owner, the lead is rejected regardless of experience. These are almost always personal brands, consultants, coaches, or methodology vendors — not real B2B product companies.

Lives in `filter.js::applySizeConditionalRules`.

### 0.E — Campaign-driven exclusions

Per the active campaign (`Campaigns/*.md`):
| # | Rule | Input | Check |
|---|------|-------|-------|
| 0.E.1 | Excluded role | `lead.currentTitle` | Title contains: `intern`, `trainee`, `student`, `assistant`, `apprentice` |
| 0.E.2 | Existing client | `lead.currentCompany` | Company in `existingClients` list |
| 0.E.3 | Blacklisted | `lead.fullName`, `lead.currentCompany` | Name or company in `blacklist` |
| 0.E.4 | Competitor employee | `lead.currentCompany` | Company in `competitors` list |
| 0.E.5 | Lead-gen / outbound vendor regex | `lead.headline`, `lead.summary` | See Gate 1 Row 1.4 |

---

## Gate 1 — Company Qualifying

A lead's company must pass **every row** in this gate. A single failure rejects.

| # | Rule | Input | Check | Outcome on fail |
|---|------|-------|-------|-----------------|
| 1.1 | Company sells to businesses (B2B) | `headline`, `summary`, `companyDescription` | ≥1 Primary B2B keyword, OR ≥2 Secondary B2B keywords | reject — not B2B |
| 1.2 | Not a competitor company | `currentCompany`, `headline`, `summary` | No competitor brand + no competitor-signal keywords | reject — competitor |
| 1.3 | Not an excluded industry | `currentCompany`, `headline` | No match against excluded-industry list | reject — excluded industry |
| 1.4 | Not a vendor / peer role | `headline`, `summary` | No vendor regex hit (lead-gen agency owners, "I help B2B founders book meetings", etc.) | reject — vendor |
| 1.5 | Not enterprise / public | `/company.employeeCount` | `employeeCount < 5000` | reject — enterprise |
| 1.6 | Not in hard-excluded geography | `lead.location` | Location does not contain any hard-excluded country/city | reject — excluded geo |

**Notes:**
- Row 1.5 needs `/company` enrichment to be reliable.
- Row 1.6 is HARD exclusion. Other geographies are graded in Gate 3 (Priority Signals).

### Primary B2B keywords (≥1 match passes Row 1.1)
> `b2b`, `business to business`, `enterprise software`, `b2b saas`, `saas`, `software as a service`, `software`, `subscription`, `b2b platform`, `b2b services`, `b2b tech`, `b2b fintech`, `selling to businesses`, `selling to enterprises`

### Secondary B2B keywords (≥2 matches passes Row 1.1)
> `mrr`, `arr`, `recurring revenue`, `enterprise`, `business clients`, `business customers`, `corporate clients`, `platform`, `api`, `cloud`, `tech`, `technology`, `fintech`, `martech`, `regtech`, `proptech`, `insurtech`, `hrtech`, `edtech`, `devtools`, `developer tools`, `cybersecurity`, `data`, `infra`, `infrastructure`, `b2b agency`, `b2b consultancy`, `b2b consulting`

### Competitor-signal phrases (any match rejects at Row 1.4)
> `b2b marketing`, `b2b outbound`, `b2b lead`, `b2b pipeline`, `b2b growth`, `b2b sales`, `lead generation agency`, `outbound agency`, `cold email agency`, `sdr as a service`, `bdr as a service`

### Excluded industries (Row 1.3)
**Non-B2B:** `b2c`, `consumer`, `direct to consumer`, `dtc`, `ecommerce` (B2C), `retail`, `hospitality` (B2C), `restaurants`, `food and beverage`, `clothing`, `fashion`, `cosmetics`, `gaming`, `entertainment`, `personal coaching`, `dating app`, `social network`, `it services and it consulting`, `staffing and recruiting`, `outsourcing/offshoring consulting`, `real estate` (residential), `construction`, `medical practice`, `dental practice`, `legal services`

**B2B services we don't sell to:** `digital marketing agency`, `marketing agency`, `app development agency`, `web development agency`, `mobile app development`, `web design agency`, `design agency`, `creative agency`, `branding agency`, `pr agency`, `media agency`, `advertising agency`, `seo agency`, `content agency`

### Hard-Excluded Geographies (Row 1.6)
> Afghanistan, Bangladesh, Nepal, Pakistan (and major cities: Kabul, Dhaka, Kathmandu, Karachi, Lahore, Islamabad)

---

## Gate 2 — Persona Qualifying (size-conditional, soft on null bracket)

If Gate 1 passes, classify the lead into a persona bracket using a normalized title and the campaign's bracket templates.

### Title normalization (runs before bracket matching)

To catch industry abbreviations: `BD → business development`, `Biz Dev → business development`, `RevOps → revenue operations`, `Rev Ops → revenue operations`, `SalesOps / Sales Ops → sales operations`, `GTMops / GTM Ops → gtm operations`, `Ops → operations`, `MD → managing director`, `SVP → senior vice president`, `EVP → executive vice president`, `VP → vice president`.

Lives in `filter.js::normalizeTitle`.

### Bracket Definitions

| Bracket | Title tokens (after normalization) |
|---------|------------------------------------|
| **Founder** | Founder, Co-Founder, Cofounder, CEO, Chief Executive (Officer), Owner, Managing Partner, Managing Director |
| **Executive** | CTO, CPO, COO, CFO, CMO, CRO, CIO, CHRO, CGO, Chief Revenue / Marketing / Operating / Technology / Product / Information / Financial / Human Resources / Growth Officer, VP / Vice President / SVP / EVP / Senior VP / Executive VP |
| **Operator** | (~70 titles, widened in 2026-05) Head of / Director of / VP of / Lead / Manager in: Sales, Growth, Marketing, Revenue, GTM, Demand (Generation), SEO, Business Development (incl. "BD"), Partnerships, **Operations**, **Sales Operations / Sales Ops**, **Revenue Operations / RevOps**, **GTM Operations**, Strategy. Plus C-suite Operating / Revenue / Marketing / Growth Officers (COO/CRO/CMO/CGO). |

### Size-Conditional Qualification

| Company size | Brackets accepted | Extra check |
|--------------|-------------------|-------------|
| **= 1 employee** (solo) | None — hard-rejected at 0.D | — |
| **< 10** (sizeTier `early`) | Founder, Executive only — **Operator rejected** | Legitimacy: `totalExperienceYears >= 6` |
| **≥ 10** (`growth` / `sweet_spot` / `scale`) | All three brackets qualify | None |
| **≥ 5000** (`enterprise`) | Rejected at Gate 1 Row 1.5 | — |
| **unknown** (enrichment failed) | All three brackets, no legitimacy check. Flag for manual review. | None |

### Soft bracket=null behavior (2026-05 change)

Bracket=null is NO LONGER a hard reject. Anyone who passes the IC short-circuit (0.C) but doesn't match any bracket template is an ambiguous senior title — e.g., "Director of Strategy", a non-English title, or a new title we haven't seen. These get `personaBracket = 'unknown'` and pass through to the AI for final judgment. The IC short-circuit already filters out clear non-decision-makers.

Lives in `filter.js::classifyPersonaBracket` and `filter.js::matchesICP`.

**Bypass:** if `directIntent = true`, all size-conditional rules are skipped.

---

## Gate 3 — Priority Signals (informational, never reject)

These attach a priority label to the lead. They do not gate it out.

### Signal A — Company Size Tier

| Tier | Headcount | Meaning |
|------|-----------|---------|
| `sweet_spot` | 101 – 200 | Best fit — growth-stage with budget and need |
| `growth` | 11 – 100 | Strong fit — scaling, probably has budget |
| `scale` | 201 – 4999 | Good fit — larger ops |
| `early` | 1 – 10 | Acceptable but lower priority |
| `enterprise` | ≥ 5000 | Rejected at Gate 1 Row 1.5 |
| `unknown` | Enrichment failed | Treated as `growth` |

### Signal B — Sales / Growth Hiring

`hiring_top_priority = true` when `/company_jobs` returns any open role matching: `/sales|sdr|bdr|account\s*exec|cro|chief\s*revenue|vp\s*sales|head\s*of\s*sales|sales\s*director|revenue\s*lead|growth|seo|gtm|demand\s*gen/i`.

### Signal C — Geography Priority

| Tier | Locations |
|------|-----------|
| `priority` | United States, USA, Canada, United Kingdom, Europe (Germany, Netherlands, France, Spain, Italy, Sweden, Denmark, **Ireland**, Belgium, Austria, Switzerland, Portugal, Norway, Finland, Poland), UAE, Dubai, Abu Dhabi, Saudi Arabia, Qatar, Kuwait, Bahrain, Oman, Egypt, Jordan, Lebanon, Israel, Morocco, Tunisia |
| `secondary` | India, Singapore, Australia, New Zealand, Japan, South Korea, Hong Kong, Taiwan, Malaysia, Thailand, Indonesia, Vietnam, Philippines, Brazil, Mexico, Argentina, Chile, Colombia, South Africa, Kenya, Nigeria |
| `excluded` | Afghanistan, Bangladesh, Nepal, Pakistan (reject at Gate 1 Row 1.6) |

**Ireland is explicitly cream ICP**.

### Composite Priority

| Priority | Trigger |
|----------|---------|
| `top` | `directIntent = true` OR `hiring_top_priority = true` OR (`sweet_spot` size AND `priority` geo) |
| `high` | (`sweet_spot` or `growth`) AND `priority` geo |
| `medium` | (`growth` or `scale`) AND (`priority` or `secondary`) geo |
| `low` | `early` size, or `unknown` size with `secondary` geo |

---

## Gate 4 — Pipeline Cap and Deduplication (Pipeline write time)

### 4.1 — No duplicates

A person already in the Pipeline (matched by `publicIdentifier` or normalized `linkedinUrl`) is never inserted twice. New engagement signals refresh the existing record.

### 4.2 — Max two leads per company

When a third qualifying lead arrives for a company already at 2:
1. Rank all three by persona priority: `Founder > Executive > Operator`.
2. Tie-break by composite priority: `top > high > medium > low`.
3. Tie-break by recency (newest wins).
4. Keep top 2.

### 4.3 — Company key normalization

The "same company" check uses a normalized form: lowercase + strip legal suffixes (Pvt Ltd, Private Limited, Inc, LLC, GmbH, S.A., Pty Ltd, Ltd, Co, etc.) + strip trailing punctuation. `personalizer.js::cleanCompanyName` is the canonical normalizer.

---

## Gate 5 — Final AI Qualification (GPT-4o-mini, per profile)

After all hard rejects, all keyword gates, and all bracket / size / geo classifications pass, the profile is sent to GPT-4o-mini for one final pass.

The AI receives:
- All gate classifications (`personaBracket`, `sizeTier`, `companyEmployeeCount`, `geographyTier`)
- Name, title, company, headline, location
- First 500 chars of summary
- First 300 chars of company description
- Top 5 experience entries

**The AI's framing:**
- It is the LAST CHECK, not a re-do. Default to YES. Reject only on a clear red flag.
- It returns one of: `YES` / `NO` / `SEED`.

**Red flags that justify NO** (full prompt in `aiQualifier.js::buildSystemPrompt`):
1. **Solo founder personal brand** — 1-employee "company" + Founder/CEO/Owner title with no software product
2. **Sales / GTM methodology vendors** — Fieldcraft, Signal-Based GTM, "The Missing Layer", "[Name]'s Framework"
3. **Coaches, trainers, course creators, EdTech / university / academy / institute companies** — REJECT regardless of operator-bracket title. Examples: Live University, Latin America Institute of Business, GTM Academy
4. **Outbound / sales-tech ecosystem vendors** — FullEnrich, Clay, Apollo, Lemlist, Smartlead, etc. (see Disqualification 0.A — caught earlier, AI is belt-and-suspenders)
5. **Personal brand with no real company** — "Founder of John Smith Consulting"
6. **Clearly enterprise/public** — Fortune 500 / NYSE / NASDAQ ticker / known mega-cap

**Critical rule (added 2026-05):** Evaluate the **CURRENT company only**. Past jobs, side memberships, communities (GTMfund, Remote Closing Club), masterminds, courses, and self-employed gigs listed below the current role are NOISE. A founder of a real B2B SaaS who happens to be a member of a sales community is still a real B2B SaaS founder.

**Does NOT count as a reason to reject:**
- Title isn't "Founder" or "CEO" — Operator-bracket titles are equally valid
- Company isn't famous
- Geography is secondary (India, SEA, LATAM) or Ireland (Ireland is cream)
- Niche B2B vertical (legal tech, healthtech, data-centre infra, AI vision, etc.)
- Company has 2–9 employees (only solo `=1` is auto-reject)
- `personaBracket = 'unknown'` — judge from headline + summary
- Headline says "I help" — only reject if the BUSINESS sells coaching/training

**Audit trail:** every AI call writes `ai_input`, `ai_raw_answer`, `ai_decision`, `ai_judged_at` to `scraped_profiles`. Inspect via `GET /api/profiles/ai-trace?q=<name>`.

---

## Inferred Assumptions

The bets baked into this ICP. If any is wrong, the ICP needs revision.

1. **Growleads serves any B2B company across the full org seniority range.** Founders, executives, and operators are all valid prospects.
2. **Engagement with a Seed is the qualifying signal** — provided the post itself attracts buyers (Gate 0.1), not DIY-builders.
3. **Sales / growth / SEO hiring is the strongest single buying signal** Growleads can detect. Hence top-priority flag.
4. **Sweet-spot company size is 101–200.** Below 11 employees, budget is uncertain. Above 5000, internal teams dominate.
5. **Hard-excluded geographies (AF/BD/NP/PK) reject at Gate 1.** All other geographies are priority-ranked but in scope.
6. **Direct buying-intent in a comment overrides legitimacy concerns.**
7. **B2B service businesses (agencies) are out, B2B product businesses are in.**
8. **Sales-tech ecosystem vendors are competitors, not buyers.** They sell what we'd help our customers do.
9. **Training / EdTech / university / academy companies are out.** They sell courses, not products.
10. **The "DIY in-house builder" audience is NOT our buyer.** Hiring/scaling SDR team posts, in-house playbooks, tool-comparison posts attract people doing what we sell, not buying.
11. **Two leads per company is enough.** Engaging more creates noise.

---

## Implementation Map

| Rule | Lives in | Status |
|------|----------|--------|
| Gate 0.1 — post-relevance AI gate | `services/aiQualifier.js::judgePostRelevance` | ✅ |
| Gate 0.2 — direct intent fast-path | `services/directIntent.js` | ✅ |
| Disqualification 0.A — sales-tech vendor reject | `services/filter.js::checkSalesTechVendor` | ✅ |
| Disqualification 0.B — training/EdTech reject | `services/filter.js::checkTrainingVendor` | ✅ |
| Disqualification 0.C — IC titles | `services/filter.js::isIndividualContributorTitle` | ✅ |
| Disqualification 0.D — solo founder | `services/filter.js::applySizeConditionalRules` | ✅ |
| Disqualification 0.E — campaign exclusions | `services/filter.js::isDisqualified` | ✅ |
| Gate 1.1 (B2B keywords) | Campaign Section 3 | ✅ |
| Gate 1.2 (competitors) | Campaign Section 6 + `filter.js::matchesICP` | ✅ |
| Gate 1.3 (excluded industries) | Campaign Section 4 | ✅ |
| Gate 1.4 (vendor regex) | `filter.js::isVendorNotOperator` | ✅ |
| Gate 1.5 (enterprise cap) | `filter.js::matchesICP` + `companyEnrichment.js` | ✅ |
| Gate 1.6 (hard-excluded geo) | Campaign Section 4 + `filter.js::isDisqualified` | ✅ |
| Gate 2 title normalization | `filter.js::normalizeTitle` | ✅ |
| Gate 2 bracket classification | `filter.js::classifyPersonaBracket` | ✅ |
| Gate 2 size-conditional rules | `filter.js::applySizeConditionalRules` | ✅ |
| Gate 2 SOFT bracket=null (pass to AI) | `filter.js::matchesICP` + `routes/leads.js` | ✅ |
| Gate 3 Signal A (size tier) | `companyEnrichment.js` + `filter.js::classifyCompanySizeTier` | ✅ |
| Gate 3 Signal B (hiring) | `companyEnrichment.js::computeEnrichmentSignals` | ✅ |
| Gate 3 Signal C (geography) | `filter.js::classifyGeographyTier` | ✅ |
| Gate 3 composite priority | `filter.js::computePriority` | ✅ |
| Gate 4.1 dedup | `routes/leads.js` | ✅ |
| Gate 4.2 max-2-per-company | `services/pipelineCap.js` | ✅ |
| Gate 4.3 company key normalization | `personalizer.js::cleanCompanyName` | ✅ |
| Gate 5 AI qualifier | `services/aiQualifier.js::qualifyLead` | ✅ |
| Seed quality gate (≥15 posts/60d) | `routes/leads.js` POST /seeds | ✅ |
| Auto-resume enrichment progress | `routes/leads.js` engager loop | ✅ |

---

## Glossary

- **Lead** — a person scraped from a Seed's LinkedIn engagement.
- **Seed** — a public figure whose audience contains our prospects. ≥15 own posts in 60d required.
- **Pipeline** — qualified leads that pass all gates.
- **Persona bracket** — Founder, Executive, Operator, or `unknown`. Unknown bracket passes to AI for judgment.
- **Size tier** — `sweet_spot` / `growth` / `scale` / `early` / `unknown`. `enterprise` rejects.
- **Direct intent** — buying language in a comment. Forces priority `top`, bypasses legitimacy.
- **Legitimacy check** — at `early` sizeTier, `totalExperienceYears >= 6` required. Bypassed by directIntent.
- **Hiring flag** — `hiring_top_priority` if company is actively hiring sales/growth/SEO.
- **Priority** — `top` / `high` / `medium` / `low`.
- **Company cap** — max 2 leads per normalized company.
- **Post-relevance gate** — per-post AI gate that judges if a post will attract buyers vs. DIY-builders. Cached on `posts_scraped`.
- **Buyer audience** — founders/execs/operators who would BUY done-for-you outbound. NOT SDRs/managers building outbound in-house.
- **DIY-builder audience** — people running outbound themselves; competition for our service, not buyers.
- **Sales-tech vendor** — any company selling tools/data/services TO outbound teams. Peers, not buyers.
- **Training vendor** — any company selling courses/certs/bootcamps. Content sellers, not buyers.
