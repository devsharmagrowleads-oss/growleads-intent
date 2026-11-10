# Profile & Post-Engagement Scraping API

Integration reference for the LinkedIn data layer behind Growleads Intent.

Everything in this document is verified against live responses and the stored
`raw_data` in `pipeline/data/growleads.db` as of 2026-08-26. The reference
implementation is `pipeline/services/linkedin.js`.

---

## 1. Provider & auth

All data comes from a single RapidAPI provider: **`linkedin-bulk-data-scraper`**.
There is no other external data source in the system.

```
Base host:  linkedin-bulk-data-scraper.p.rapidapi.com
Scheme:     https
```

Every request carries two headers:

```http
x-rapidapi-key:  <YOUR_RAPIDAPI_KEY>
x-rapidapi-host: linkedin-bulk-data-scraper.p.rapidapi.com
```

There is no OAuth, no session, no cookie. The key is the only credential.

### Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `RAPIDAPI_KEY` | yes | Auth key sent on every request |
| `RAPIDAPI_HOST` | yes | `linkedin-bulk-data-scraper.p.rapidapi.com` |
| `RAPIDAPI_PERSON_URL` | yes | Profile endpoint |
| `RAPIDAPI_PROFILE_UPDATES_URL` | yes | Posts endpoint |
| `RAPIDAPI_POST_REACTIONS_URL` | yes | Reactors endpoint |
| `RAPIDAPI_POST_COMMENTS_URL` | yes | Commenters endpoint |
| `RAPIDAPI_INTERACTED_PROFILES_URL` | no | Seed's outbound comment activity |
| `RAPIDAPI_SIMILAR_PROFILES_URL` | no | Similar-profile discovery |
| `RAPIDAPI_COMPANY_URL` | no | Defaults to `https://$RAPIDAPI_HOST/company` |
| `RAPIDAPI_COMPANY_JOBS_URL` | no | Defaults to `https://$RAPIDAPI_HOST/company_jobs` |
| `RAPIDAPI_COMPANIES_URL` | no | Bulk company endpoint (up to 100 links/request) |
| `RAPIDAPI_MIN_INTERVAL_MS` | no | Throttle interval, default `1300` |

Each endpoint has its own URL variable so a consumer can point individual calls
at a different provider or a mock without touching code.

---

## 2. The rate-limit contract

**This is the single most important thing to get right.** The provider allows
**one request per 1.3 seconds, with no concurrency.** Bursting produces `429`s
and, worse, silent partial responses.

The reference implementation funnels *every* call through one global gate
(`throttle()` in `services/linkedin.js`) that does two things at once:

1. **Serializes** callers through a single promise chain, so two concurrent
   callers cannot race past the same timestamp and burst together.
2. **Enforces** the minimum interval since the last call.

If you reimplement this, do not use a naive `sleep(1300)` per call site. Nested
pagination loops (posts → reactions → pages) will interleave and burst. Use one
process-wide queue.

### Retry policy

| Condition | Retries | Backoff |
|---|---|---|
| `429` rate limit | 3 | Honors `Retry-After`; else 3s → 9s → 27s |
| `5xx` server error | 3 | 2s → 6s → 18s |
| Body matches `/no free account/i` | 3 | 30s flat |
| Network error, no status | 3 | 2s → 6s → 18s |
| Other `4xx` (400/401/403/404) | 0 | Fail fast |

`"No free account spotted."` is a provider-side capacity blip — their pool of
LinkedIn accounts is momentarily exhausted. It usually clears within seconds.
After 3 failed attempts the error is tagged `isProviderCapacity = true`, which
callers should treat as a **hard stop for the whole run**, not a per-item failure.

This API is genuinely flaky. Short retry budgets caused real data loss in
production before the current policy was put in place.

---

## 3. Endpoints

### 3.1 `POST /person` — profile data

The core enrichment call. One credit per profile.

```http
POST https://linkedin-bulk-data-scraper.p.rapidapi.com/person
Content-Type: application/json

{ "link": "https://www.linkedin.com/in/example-seed" }
```

Accepts both URL forms: the vanity `/in/<public-id>` form and the obfuscated
`/in/ACoAA...` member-URN form returned by `/post_reactions`.

**Response envelope**

```json
{ "success": true, "status": 200, "data": { ... } }
```

**`data` fields** (verified against stored responses):

```
urn                       publicIdentifier          fullName
firstName                 lastName                  maidenName
headline                  about                     industry
experiences[]             educations[]              skills[]
projects[]                interests[]               languages[]
organizations[]           honorsAndAwards[]         volunteerAndAwards[]
licenseAndCertificates[]
address                   addressWithCountry        addressWithoutCountry
addressCountryOnly        geoLocationBackfilled
profilePic                profilePicAllDimensions
backgroundPicture         backgroundPictureAllDimentions   [sic]
creator (bool)            influencer (bool)         premium (bool)
memorialized              tempStatus                primaryLocale
showPremiumSubscriberBadge
educationOnProfileTopCardShown    companyNameOnProfileTopCardShown
```

> **Gotcha — there are no follower or connection counts.** `data.followers` and
> `data.connections` are **not returned by this endpoint**, despite what a naive
> read of the normalizer suggests. Any `followerCount` / `connectionCount` you
> store from `/person` will be `0` for every record. `creator` and `influencer`
> are the *only* social-graph signals this provider exposes. Do not build
> scoring, sorting, or filtering on follower counts.

#### Parsing `experiences[]` — two incompatible shapes

This is where most integrations go wrong. An experience entry comes back in one
of two shapes, distinguished by the `breakdown` flag.

**Shape A — `breakdown: true`** (multiple roles at one company). The top-level
`title` is the **company name**; the actual job title is nested:

```json
{
  "title": "Smartsheet",
  "subtitle": "Full-time · 1 yr 8 mos",
  "breakdown": true,
  "companyId": "167700",
  "companyUrn": "urn:li:fsd_company:167700",
  "companyLink1": "https://www.linkedin.com/company/smartsheet-com/",
  "subComponents": [
    { "title": "Sr. Commercial Account Executive", "caption": "Apr 2026 - Present · " },
    { "title": "Commercial Account Executive",     "caption": "May 2024 - Present · 1 yr 8 mos",
      "metadata": "Remote" }
  ]
}
```

**Shape B — no `breakdown`** (single role). `title` is the **job title**;
`subtitle` is the **company**, often suffixed with employment type:

```json
{ "title": "Founder & CEO", "subtitle": "ColdIQ · Full-time" }
```

Extraction rules used in production:

- **Company** — Shape A: `title`. Shape B: `subtitle`, falling back to
  `company.name` / `companyName`. If the result starts with a digit (it's a
  duration like `"3 yrs 6 mos"`), fall back to `title`. Then strip the
  ` · Full-time|Part-time|Self-employed|Freelance|Contract|Internship|Seasonal|Apprenticeship`
  suffix. If it *still* looks like a duration, parse the company slug out of
  `companyLink1` / `companyLink2`.
- **Title** — Shape A: `subComponents[0].title`. Shape B: `title`. Strip the
  same employment-type suffix.
- **Company description** — `subComponents[0].description[0].text`.
- **Company URL** — `companyLink1` → `companyLink2`, normalized to
  `origin + pathname` with query and trailing slash removed.

#### Location fallback chain

No single location field is reliable. Check in order:

```
addressWithCountry → addressWithoutCountry → geo.full →
geo.city + ", " + geo.country → geoLocation → locationName → geoLocationName →
experiences[n].metadata  (strip " · On-site|Remote|Hybrid")
```

#### Name fallback chain

```
fullName → firstName + " " + lastName → title-cased publicIdentifier
```

For the last fallback, strip the trailing hash LinkedIn appends to non-unique
vanity IDs first: `"jacob-croker-5b688040"` → `"Jacob Croker"`
(regex `/-[a-f0-9]{6,}$/i`).

#### Total experience years

Scan **every** text-bearing field on every experience (`caption`, `subtitle`,
and stringified `subComponents`) for 4-digit years in `1950–2099`, take the
**earliest**, and subtract from the current year. Reject results outside `0–70`.

Taking the earliest across all roles (rather than summing durations) avoids
inflating the number when someone holds overlapping roles — a board seat held
during a main job would otherwise double-count.

---

### 3.2 `GET /profile_updates` — a profile's own posts

```http
GET /profile_updates?profile_url=<url>&page=1
```

**Response:** `{ posts: [ ... ] }` — some deployments nest it as
`{ response: { posts: [...] } }`. Handle both.

**Post object** (verified live):

```json
{
  "postText": "19 APIs that turn Claude Code into a GTM engine: ...",
  "postLink": "https://www.linkedin.com/feed/update/urn:li:activity:7000000000000000000",
  "urn": "urn:li:activity:7000000000000000000",
  "reactionsUrn": "urn:li:activity:7000000000000000000",
  "commentsUrn": "urn:li:fsd_socialDetail:(urn:li:activity:7000000000000000000,urn:li:activity:7000000000000000000,urn:li:highlightedReply:-)",
  "repostsUrn": "...",
  "actor": { ... },
  "is_repost": false,
  "socialCount": { "numLikes": 0, "numComments": 0, ... },
  "postedAgo": "2w",
  "postedAt": "2026-08-10T09:14:00.000Z",
  "imageComponent": { ... },
  "linksInPost": [ ... ]
}
```

Note the two URN formats: `reactionsUrn` is the plain activity URN, while
`commentsUrn` is a **compound `fsd_socialDetail` URN with parentheses and
commas**. Pass it through verbatim — URL-encode it, never reconstruct it.

**Results are reverse-chronological.** Posts are returned newest-first, so
"take the last N posts" is a simple `slice(0, N)`.

**Filtering rules applied by the reference implementation**, in order:

1. **Drop reposts** (`is_repost === true`). Repost engagement belongs to the
   *original* author's audience, not this profile's — mining it pollutes the
   pipeline with the wrong people.
2. **Slice to `limit`** (default 20).
3. **Drop posts older than `maxAgeDays`** (default 60), parsed from `postedAt`.
   When `postedAt` is missing, **keep** the post — don't punish API gaps.
4. **Dedupe** on the first available of `reactionsUrn` / `urn` / `commentsUrn` /
   `postLink`. Self-reposts surface the same post twice.

The implementation returns a `_meta` block so callers can see exactly what was
dropped and why:

```json
{ "rawCount": 20, "repostsDropped": 6, "slicedCount": 5,
  "droppedByAge": 0, "duplicatesDropped": 0, "filteredCount": 5,
  "limit": 5, "maxAgeDays": 3650 }
```

---

### 3.3 `GET /post_reactions` — who reacted

```http
GET /post_reactions?reactionsUrn=urn:li:activity:7000000000000000000&page=1
```

**Response:**

```json
{
  "success": true,
  "status": 200,
  "reactions": [
    {
      "title": "Jane Example",
      "subtitle": "Head of Growth at Example Co",
      "navigationUrl": "https://www.linkedin.com/in/ACoAAEXAMPLE",
      "actionUrn": "urn:li:fsd_profile:ACoAAEXAMPLE",
      "reactionType": "LIKE",
      "image": { "profilePic": "https://...", "profileUrn": "ACoAAEXAMPLE" },
      "actor": { "companyUrn": null, "*profileUrn": "urn:li:fsd_profile:..." }
    }
  ],
  "pagination": { "count": 10, "start": 0, "total": 298 }
}
```

**Page size is 10.** `pagination.total` is the true reactor count.

---

### 3.4 `GET /post_comments` — who commented

```http
GET /post_comments?commentsUrn=<compound-urn>&page=1
```

**Response:**

```json
{
  "success": true,
  "status": 200,
  "comments": [
    {
      "commenter": {
        "title": "John Sample",
        "subtitle": "Founder at Sample Inc",
        "navigationUrl": "https://www.linkedin.com/in/example-user",
        "image": "https://..."
      },
      "text": "Interesting take, how do you handle this at scale ...",
      "permalink": "https://...",
      "timestamp": "...",
      "repliesCount": 0,
      "reactionTypeCounts": [ { "count": 1, "type": "LIKE" } ],
      "topReplies": [ ... ],
      "pinned": false,
      "edited": false
    }
  ],
  "pagination": { "count": 10, "start": 0, "total": 42 }
}
```

The person is at `comments[n].commenter.navigationUrl`; the comment body is at
`comments[n].text`. Page size is 10.

> **Gotcha — reactions and comments return different URL formats for the same
> person.** `/post_reactions` returns the **obfuscated** member URN
> (`/in/ACoAAEXAMPLE`); `/post_comments` returns the **vanity** public
> identifier (`/in/example-user`). Both are valid inputs to `/person`, but they
> are *different strings for the same human*. If you key your profile cache on
> URL alone, you will scrape — and pay for — the same person twice. See §5.

---

### 3.5 `GET /comments_from_recent_activity` — outbound comment activity

Posts that a given profile has commented **on**, plus who authored them. Useful
for discovering the accounts a person actively engages with.

```http
GET /comments_from_recent_activity?profile_url=<url>&page=1
```

**Response:**

```json
{
  "posts_with_comments": [
    {
      "actor": { "actorLink": "https://www.linkedin.com/in/...", "actorName": "..." },
      "highlightedComment": {
        "commenter": { "navigationUrl": "..." },
        "reply":     { "commenter": { "navigationUrl": "..." } }
      }
    }
  ]
}
```

`actorLink` carries query params (`?miniProfileUrn=...`) — strip them before use.

---

### 3.6 `GET /similar_profiles` — lookalike discovery

```http
GET /similar_profiles?profileUrl=<url>&page=1
```

**Response:** `{ success, status, response: [ { publicIdentifier, titleV2, subtitleV2, textActionTarget, ... } ] }`

Note the parameter is `profileUrl` (camelCase), **not** `profile_url` as in
`/profile_updates` and `/comments_from_recent_activity`. The provider is
inconsistent here; it is not a typo in this document.

---

### 3.7 `POST /company` — company data

```http
POST /company
{ "link": "https://www.linkedin.com/company/smartsheet-com/" }
```

**Response:** `{ success, status, data: { companyName, companyId, employeeCount, employeeCountRange: { start, end }, locations[], specialities[], ... } }`

1 credit per call. `employeeCount` drives the size gate.

### 3.8 `POST /company_jobs` — open roles

```http
POST /company_jobs
{ "company_url": "<url>", "count": 25, "start": 0 }
```

**Response:** `{ success, status, response: { data: { jobs: [ { title, companyName, ... } ] } } }`

Handle three possible nestings: `response.data.jobs`, `data.jobs`, `jobs`.

> **This endpoint is plan-gated.** It is disabled by default in the reference
> implementation (`COMPANY_JOBS_ENABLED`) because it burns credits returning
> errors on plans that don't include it. Enable it deliberately.

### 3.9 `POST /companies` — bulk company lookup

Accepts up to **100 company links per request**. Prefer this over looping
`/company` for any batch job.

---

## 4. The engagement-mining flow

How the endpoints compose into "find people who engaged with a given account":

```
  seed profile URL
        │
        ├─► POST /person ─────────────► profile attributes
        │
        └─► GET /profile_updates ─────► posts (drop reposts, ≤20, ≤60 days)
                    │
                    ├─ post.reactionsUrn ─► GET /post_reactions  (paginate)  ─┐
                    │                                                         ├─► engager URLs
                    └─ post.commentsUrn  ─► GET /post_comments   (paginate)  ─┘        │
                                                                                       ▼
                                                                          POST /person per engager
```

Pseudocode for one post:

```js
const engagers = [];

if (post.reactionsUrn) {
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { reactions = [] } = await getPostReactions(post.reactionsUrn, page);
    for (const r of reactions) {
      if (r.navigationUrl && r.navigationUrl !== seedUrl)
        engagers.push({ url: r.navigationUrl, engagementType: 'reaction' });
    }
    if (reactions.length < 10) break;          // page size is 10
  }
}

if (post.commentsUrn) {
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { comments = [] } = await getPostComments(post.commentsUrn, page);
    for (const c of comments) {
      const url = c?.commenter?.navigationUrl || c?.navigationUrl;
      if (url && url !== seedUrl)
        engagers.push({ url, engagementType: 'comment', commentText: c?.text || '' });
    }
    if (comments.length < 10) break;
  }
}
```

**Always exclude the seed's own URL** — an author reacting to or replying on
their own post shows up in both feeds.

> **Known limitation.** The loop above breaks on `length < 10` and caps at
> `MAX_PAGES = 15`, giving a ceiling of **~150 engagers per feed per post**. A
> post with `pagination.total = 298` is silently truncated at roughly half. The
> `pagination.total` field is returned but currently unused. A new integration
> should paginate on `start + count < total` and raise or remove the page cap.

---

## 5. Credit model & caching

Every API call is one RapidAPI credit. Profile scraping dominates the bill:
mining a single post with 200 engagers costs ~20 pagination credits and up to
200 profile credits.

Three caches keep re-runs near-free:

| Cache | Store | TTL | Saves |
|---|---|---|---|
| Profile | `scraped_profiles` table | 30 days (`cacheTtlDays`) | `POST /person` |
| Post engagers | `posts_scraped.engager_urls` (JSON) | indefinite | reaction/comment pagination |
| Company | `company_scrape` table | 30 days (`COMPANY_CACHE_TTL_DAYS`) | `POST /company` |

Current scale in this database: **7,355 cached profiles**, **1,406 posts**
holding **14,725 engager records**.

### Person-level dedupe — the part that actually saves money

Because reactions return `ACoAA...` URNs and comments return vanity IDs (§3.4),
a URL-keyed cache misses constantly. The lookup must be **two-level**:

```js
// 1. exact match on the normalized URL
let hit = await ScrapedProfile.findOne({ linkedinUrl: cleanLinkedInUrl(url) });

// 2. fall back to the vanity public identifier extracted from the URL
if (!hit) {
  const pid = vanityPublicId(url);          // null for ACoAA... forms
  if (pid) hit = await ScrapedProfile.findOne({ publicIdentifier: pid });
}
```

Two helpers make this work (`vanityPublicId` is currently internal to
`services/linkedin.js` — export it if you consume the module directly):

```js
// Strip query params AND trailing slash, so ".../in/x" and ".../in/x/" are one key.
function cleanLinkedInUrl(url) {
  let u;
  try { u = new URL(url).origin + new URL(url).pathname; }
  catch { u = url.split('?')[0]; }
  return u.replace(/\/+$/, '');
}

// Return a usable person key ONLY for the vanity form.
// The obfuscated ACoAA... URN is not a stable public identifier.
function vanityPublicId(url) {
  const m = (url || '').match(/\/in\/([^/?#]+)/i);
  if (!m) return null;
  let id = m[1];
  try { id = decodeURIComponent(id); } catch {}
  if (/^ACoA/i.test(id)) return null;
  return id.toLowerCase();
}
```

A profile scraped under *either* URL form stores its vanity `publicIdentifier`
from the `/person` response, so a later hit on the other form resolves to the
same row at zero credits.

**Cache-write failures must never fail the caller.** Log and continue — a
dropped cache write costs one credit next run; a thrown exception loses the
whole record.

### Cooldown

Independently of the cache TTL, the pipeline refuses to re-scrape any person
seen in the last **30 days**, checked against both the seed and lead tables by
URL *or* `publicIdentifier`.

---

## 6. Integration checklist

- [ ] One process-wide request queue at ≥1300 ms, serialized — not per-call-site sleeps
- [ ] Retry `429` / `5xx` / `no free account`; fail fast on other `4xx`
- [ ] Treat `isProviderCapacity` as a run-level abort, not an item-level failure
- [ ] Handle both `experiences[]` shapes (`breakdown` flag) — §3.1
- [ ] Strip employment-type suffixes from company and title
- [ ] Walk the full location fallback chain
- [ ] Do not depend on follower or connection counts — they are not returned
- [ ] Drop `is_repost` posts before mining engagers
- [ ] URL-encode `commentsUrn` verbatim; never reconstruct the compound URN
- [ ] Exclude the seed's own URL from both engagement feeds
- [ ] Paginate on `pagination.total`, not a fixed page cap
- [ ] Key the profile cache on URL **and** vanity `publicIdentifier`
- [ ] Never let a cache-write error propagate to the caller

---

## 7. Reference implementation

| Concern | File |
|---|---|
| All API wrappers, throttle, retry, normalizers | `pipeline/services/linkedin.js` |
| Seed → posts → engagers orchestration | `pipeline/core/pipeline.js` |
| Company enrichment + size gate | `pipeline/services/companyEnrichment.js` |
| Persistent company cache | `pipeline/services/companyCache.js` |
| Cache tables (`scraped_profiles`, `posts_scraped`, `company_scrape`) | `pipeline/models/db.js` |

Exported surface of `services/linkedin.js`:

```js
getProfileByUrl(url)                     // raw POST /person
getProfileCached(url, { cacheTtlDays })  // → { raw, normalized, fromCache }
getProfilePosts(url, { page, limit, maxAgeDays })
getPostReactions(reactionsUrn, page)
getPostComments(commentsUrn, page)
getInteractedProfiles(profileUrl, page)
getSimilarProfiles(profileUrl, page)
getCompanyData(companyUrl)
getCompanyJobs(companyUrl, count, start)
normalizeProfile(raw, linkedinUrl)
computeEngagementStats(postsResponse)
cleanLinkedInUrl(url)
```

`getProfileCached()` always returns `fromCache`, so callers can log credit
usage transparently rather than guessing at spend.
