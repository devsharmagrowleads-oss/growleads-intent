# Company Exclusion — Outbound / Sales-Tech / GTM Peers

> **Auto-applied** by `pipeline/services/exclusion.js` to every qualified list
> (AI Visibility and Lead Gen). Any company matching this rule is removed
> automatically. This file is the human-editable source — **add a company by
> adding its LinkedIn company slug under the Denylist section below.**

## Why these are excluded
Companies of the **Clay / Smartlead / Unify** type (outbound sales-tech software),
**Cold IQ** type (GTM / outbound agencies & done-for-you lead-gen), and
**Sales Rebellion** type (sales training / coaching / community) are **Growleads'
own space** — direct competitors and peers. They are mining sites and benchmarks,
**never customers**. Selling them AI Visibility or Lead Gen makes no sense, so the
intent system strips them out before any list is finalised.

## The three types we exclude
1. **Outbound sales-tech / lead-gen SOFTWARE** — Clay, Smartlead, Unify, lemlist,
   Saleshandy, Salesforge, FullEnrich, Maildoso, TexAu, Instantly, Apollo … (cold
   email, data enrichment, deliverability, prospecting, AI SDR, sales automation).
2. **GTM / outbound AGENCIES & services** — Cold IQ, The Pipeline Group, AltiSales,
   FullFunnel, Outbound OS, LeadCoverage, AudienceLed … (done-for-you outbound,
   appointment setting, lead generation as a service, RevOps agencies).
3. **Sales training / coaching / community** — Sales Rebellion, Sales Assembly,
   SalesPlaybook, AlwaysHired, SDR Leaders … (sales bootcamps, academies, coaching).

## Keyword rule (auto-catches NEW companies)
A company is excluded if its **name, tagline, or description** contains any of
these seller phrases (case-insensitive). Kept deliberately high-precision — bare
`sales` / `revenue` / `crm` / `pipeline` do **not** trigger it:

- cold email · cold call · cold outreach
- outbound
- lead gen · lead generation · leadgen · lead maker
- appointment setting · booked meetings
- SDR · BDR · sales development rep · AI SDR · AI BDR
- sales engagement · sales automation · prospecting
- LinkedIn automation · LinkedIn outreach · social selling
- data enrichment · waterfall enrichment · email finder · email verification
- email deliverability · email infrastructure · email warmup
- sales coach · sales training · sales bootcamp · sales academy · sales enablement
- done-for-you outbound/lead/appointment · book(ed) more meetings · b2b lead

**Never excluded** (protected): market research · consumer insights.

## Person-level exclusion (ecosystem interlink)
Even when a person's CURRENT company isn't a denylisted peer, their own identity
can tie them to the outbound / sales-tech world. Enforced by
`services/exclusion.js → isExcludedPerson()`, scanning their **headline + bio/about
+ all work experiences** (from the scraped profile). A decision-maker is removed if:

1. **Tool partner / expert** — headline/bio names a denylisted tool alongside a
   partner word: `Clay Expert`, `Certified Clay Partner`, `Smartlead Partner`,
   `Instantly/lemlist/Unify consultant / specialist / ambassador / reseller`.
2. **Outbound / sales-tech operator identity** — GTM Engineer · Growth Engineer ·
   outbound expert/consultant/strategist/architect · cold-email expert/system ·
   cold outbound · cold calling · lead-gen expert/agency · demand-gen consultant ·
   appointment setter · email deliverability · sales coach/trainer · prospecting
   expert · social-selling coach · "founder of an outbound/lead-gen/appointment
   agency" · "we help you book (more) meetings" · "predictable pipeline" ·
   "systemised outbound".
3. **Experience interlink** — they list a denylisted peer company (by name) OR an
   outbound/sales-tech-named company in their work history. Matched on the company
   NAME only (so "SDR at Lenovo" is NOT a false interlink).

4. **Non-buyer functional role** — the person's CURRENT title is a function that
   isn't the AI-Visibility buyer: **account management** (Account Manager/Director,
   Director of Account Management, Key Account), **creative / design** (Creative Director,
   Art Director, Design Director, Product Design/Designer, Head of Design, UX/UI), **commercial** (Chief Commercial Officer / CCO, Commercial Director),
   or **HR / People / Talent** (CHRO, Chief People/Talent Officer, Head of People,
   HR Manager/Director, Talent Acquisition, Recruiter). Founders / CEOs / owners are **exempt** — they're the
   decision-maker whatever secondary hat they wear (e.g. "Co-Founder, CCO" is kept).

Every removed person is logged to `output/ai_visibility_excluded_people_log.csv`
(name · title · company · LinkedIn · reason · headline).


## Denylist (known companies — LinkedIn company slugs)
The specific companies already identified in our data (and famous peers). One
LinkedIn slug per bullet; the comment is just the display name.

- allreach  <!-- allreach -->
- altisales  <!-- AltiSales -->
- alwayshired  <!-- AlwaysHired Sales Bootcamp -->
- ansoft-solutions  <!-- Ansoft Solutions -->
- apollo-io  <!-- Apollo.io -->
- arnies-ai  <!-- Arnies-ai -->
- art-of-sales-academy  <!-- Art of Sales Academy -->
- askelephant  <!-- AskElephant -->
- audienceled  <!-- AudienceLed -->
- b2blinkedpro  <!-- B2BLinkedPro -->
- bleedai  <!-- Bleed AI -->
- blynked  <!-- Blynked -->
- braindonors  <!-- BrainDonors - B2B growth agency -->
- carnegie-search  <!-- Carnegie Search -->
- clay  <!-- Clay -->
- coachwayapp  <!-- Coachway (Formerly EmpowrCoach) -->
- coldlabs  <!-- ColdIQ -->
- coldtowne-theater  <!-- ColdTowne Business Improv -->
- easyyhire  <!-- Easyyhire -->
- enablement-ch  <!-- Enablement.ch -->
- expertise-ai  <!-- Expertise AI -->
- fullenrich  <!-- FullEnrich -->
- fullfunnel  <!-- FullFunnel -->
- getreachly  <!-- Reachly -->
- gliped  <!-- GLIPED - Best LinkedIn Personal Branding Agency -->
- go-online-now-connect  <!-- Go Online Now-Connect -->
- goddard-strategies  <!-- Goddard Strategies -->
- grow-big-ventures  <!-- Grow Big Ventures -->
- growmysme  <!-- GrowMySME -->
- growsurely  <!-- Grow Surely -->
- growth-cab  <!-- Growth Cab -->
- growthtoday  <!-- Growth Today -->
- hakulabsai  <!-- Haku AI -->
- inboxkit  <!-- Inboxkit -->
- inside-global  <!-- Inside Global - GTM Lead Gen & SDR Experts -->
- instantly-ai  <!-- Instantly -->
- intentsify  <!-- Intentsify -->
- intentsignal  <!-- IntentSignal -->
- it-s-destiny-recruiting  <!-- It's Destiny Recruiting -->
- itslavenderduh  <!-- Lavender -->
- joinab  <!-- A/B -->
- kinetic-wireless  <!-- Kinetic Wireless - Rogers Authorized Dealer -->
- lead-coverage  <!-- LeadCoverage -->
- leadgenjay  <!-- Lead Gen Jay -->
- leadgpthk  <!-- LeadGPT -->
- leadgrow-ai  <!-- LeadGrow.ai -->
- leadlypro  <!-- LeadlyPro -->
- lemlist  <!-- lemlist -->
- linkedsdr  <!-- LinkedSDR -->
- magnetixlead  <!-- Magnetixlead -->
- maildoso  <!-- Maildoso -->
- mailinai  <!-- Mailin -->
- mangopartners  <!-- Mango Partners -->
- maverrik  <!-- MAVERRIK - Social Selling Training -->
- md-mediaa  <!-- MD media -->
- million-leads-official  <!-- Million Leads -->
- missioninbox  <!-- Mission Inbox -->
- nametoprofile  <!-- NameToProfile -->
- navreo  <!-- navreo.ai -->
- ndotrich  <!-- N.Rich -->
- nextgensalesai  <!-- NextGen -->
- ng-business-digital-marketing-company  <!-- NG Business -->
- notusxyz  <!-- notus -->
- nuvia-ai  <!-- Nuvia -->
- ordesa-ai  <!-- Ordesa AI -->
- outera-io  <!-- Outera -->
- outflo-ai  <!-- OutFlo AI -->
- outreach  <!-- Outreach -->
- parakeetio  <!-- Parakeet -->
- pareto-usa  <!-- Pareto USA -->
- passion4growth  <!-- Passion4Growth -->
- peakora  <!-- Peakora -->
- peeker-ai  <!-- Peeker AI -->
- proleadmaker  <!-- Pro Lead Maker -->
- rev-gen-labs  <!-- Revenue.Inc -->
- revcentricai  <!-- RevCentric.ai -->
- revenueflowdotcom  <!-- RevenueFlow -->
- revenvy  <!-- RevEnvy -->
- ribitai  <!-- Ribit -->
- rizq-rise  <!-- Rizq Rise -->
- saas-outbound  <!-- SaaS Outbound -->
- sales-assembly  <!-- Sales Assembly -->
- sales-automation-ai  <!-- Sales-Automation.ai -->
- sales-sciencehq  <!-- Sales Science -->
- salesauto  <!-- salesauto -->
- salesautomationsystem  <!-- Sales Automation Systems -->
- salesdriver-io  <!-- SalesDriver -->
- salesforgeai  <!-- Salesforge.ai -->
- saleshandy  <!-- Saleshandy -->
- salesloft  <!-- Salesloft -->
- salesrebellion  <!-- Sales Rebellion -->
- salesup-club  <!-- SalesUP -->
- saverflow  <!-- Saverflow AI -->
- scaletopia  <!-- Scaletopia -->
- sdr-leaders-of-usa  <!-- SDR Leaders of USA -->
- sellbetterxyz  <!-- Sell Better -->
- sendtrumpet  <!-- trumpet -->
- shift-groupllc  <!-- Shift Group -->
- sitetuners  <!-- SiteTuners -->
- smartlead-ai  <!-- Smartlead -->
- sojib-360-lead  <!-- SOJIB 360 LEAD -->
- spectra-acquisition  <!-- Spectra Acquisition -->
- stackoptimise  <!-- StackOptimise -->
- strongest-group  <!-- Strongest Group -->
- sv-institut-tech-sales-bootcamp  <!-- SV Institut Tech Sales Bootcamp -->
- sword-saas-coaching  <!-- SWORD SaaS Coaching -->
- synapse-automate  <!-- Synapse -->
- taskbase  <!-- Taskbase -->
- tenet-recruitment  <!-- TENET GTM -->
- texauhq  <!-- TexAu -->
- the-growth-agency-digital  <!-- The Growth Agency -->
- the-outbound-os  <!-- Outbound OS -->
- the-pipeline-group.io  <!-- The Pipeline Group -->
- the-saas-institute  <!-- The Sales Institute -->
- the-sales-circle  <!-- The Sales Circle -->
- the-sales-playbook  <!-- SalesPlaybook -->
- theampsocial  <!-- AMP Social -->
- trysignalbase  <!-- Signalbase -->
- understory-agency  <!-- Understory -->
- unify  <!-- Unify -->
- unifygtm  <!-- Unify -->
- vanellagroup  <!-- The Vanella Group, Inc. -->
- wearesalestitans  <!-- Sales Titans -->
- whistleltd  <!-- Whistle -->
- whitewhale-ai  <!-- WhiteWhale -->
- wildcardintros  <!-- Wildcard -->
- wizlabs-llc  <!-- Wiz Labs -->
- workflows-io  <!-- Workflows.io -->
- zevenue  <!-- Zevenue -->
- coldiq  <!-- ColdIQ alias -->
- clay-labs  <!-- Clay alias -->


## Change log
1. **2026-08-24** — Created the rule. Company-level exclusion of outbound /
   sales-tech / GTM / sales-training peers (Clay, Smartlead, Unify, Cold IQ, Sales
   Rebellion type). Keyword rule + 133-slug denylist. Effect on the AI-Visibility
   list: 944 → 790 contacts (154 peer people removed); qualified companies
   3,843 → 3,512.
2. **2026-08-25** — Added **person-level (ecosystem interlink)** exclusion:
   tool partners/experts, outbound-operator identities, and experience-at-peer-
   company. Removed MRI-Simmons from the denylist (it is protected market research;
   it had caused a false interlink). Effect: 790 → **748** final contacts
   (42 ecosystem people removed — 30 operator identity, 3 tool partner, 9 experience
   interlink). Each removal logged to output/ai_visibility_excluded_people_log.csv.
3. **2026-08-25** — Lowered the **big-enterprise ceiling** from 5,000 to
   **1,000** headcount (companies with >1000 employees are excluded — Samsung,
   Apple, Google, Microsoft, Lenovo and all large enterprise). Applied in the
   AI-Visibility size gate (`qualify-ai-visibility.js`) and the contact export
   (`export-ai-visibility-full.js`). Effect: 748 → **696** final contacts
   (52 big-enterprise contacts removed); qualified companies now 3,213.
4. **2026-08-25** — Added **non-buyer role** exclusion: account-management,
   creative, and commercial (CCO) titles are removed (founders/CEOs exempt).
   Effect: 696 → **679** final contacts (17 non-buyer roles removed).
5. **2026-08-25** — Extended non-buyer roles to **product / design** titles
   (Director of Product Design, Head of Product Design, Product Designer, UX/UI,
   graphic designer). Product *management* (Head of Product/VP Product) is kept.
   Effect: 679 → **678** final contacts. Every eliminated person is recorded in
   output/ai_visibility_excluded_people_log.csv so these titles are auto-removed
   from all future runs.
6. **2026-08-25** — Added **VC / private-equity / investment firm** exclusion
   (judged on Company Industry = Venture Capital & Private Equity / Investment
   Banking / etc., plus unambiguous text like 'venture capital', 'we invest in
   startups', 'angel fund'). Also reordered the export columns to the agreed header
   (company block moved directly after Person Industry). Effect: 678 → **663**
   final contacts (VC/investment firms removed).
7. **2026-08-25** — Added **HR / People / Talent** roles to the non-buyer
   exclusion (CHRO, Chief People/Talent Officer, Head of People/HR, HR
   Manager/Director, People Experience, Talent Acquisition, Recruiter). Founders
   exempt. Effect: 663 → **655** final contacts.
