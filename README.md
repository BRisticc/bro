# Brand Niche & Ad Angle Intelligence

An [Apify](https://apify.com) actor that takes **one web page**, works out **which brands are on it and what they actually do**, sorts them into **niche → sub-niche → audience**, then goes to the **Meta Ad Library** for each brand and reverse-engineers **the angles their highest-exposure ads are running**.

That is the whole journey, in one run:

```
source page  →  brands  →  brand sites  →  niche / sub-niche  →  Ad Library  →  angle breakdown  →  report
   (input)      discover     profile          classify            research        analyse          output
```

---

## What it does, stage by stage

### 1. Discover — who is actually on this page?

Point it at any page that talks about brands: a listicle ("25 best men's supplement brands"), a retailer's stockist page, an awards list, a directory, a marketplace category. The actor pulls the outbound links, then filters hard:

- same-site links, social networks, marketplaces (Amazon, Sephora), publishers, research sites and CDNs are dropped by a built-in denylist;
- legal/account/asset paths (`/privacy`, `/login`, `*.png`) are dropped;
- what survives is scored on how brand-like the link looks — a link *inside a heading* is worth far more than one in a footer, short capitalised anchor text beats "click here", and repeat mentions count with heavy diminishing returns.

Brand names come from the strongest available source: a heading containing the domain stem beats anchor text, which beats the domain itself.

If the page *is* a single brand's own site, set `discoveryMode` to `single-brand` (or leave it on `auto` — fewer than three surviving external domains is read as a single-brand page).

### 2. Profile — what do they sell?

Each brand's own site is then visited for: structured name (JSON-LD `Organization` → `og:site_name` → anchor text → domain), description, tagline, e-commerce platform, social profiles, and product names with prices. On Shopify stores the public `/products.json` endpoint is used, which is by far the cleanest product source. `profileDepth` controls how far it goes:

| Depth | What it fetches |
| --- | --- |
| `fast` | homepage only |
| `standard` | homepage + `/products.json` + 2 on-site pages (about, shop, science…) |
| `deep` | as above with up to 5 extra on-site pages |

A brand whose site is down still gets a row, with the failure recorded in `notes` — a dead site is itself a finding.

### 3. Classify — which niche and sub-niche?

Everything collected becomes one corpus, scored against a weighted taxonomy of **18 niches and 73 sub-niches**: `Supplements → Men's health`, `Supplements → Sports & performance`, `Skincare → Anti-aging`, `Skincare → Acne & blemish`, `Haircare → Hair growth & loss`, `Sexual wellness → Male sexual health`, and so on. It is not DTC-only: `Professional & B2B services` covers recruitment & staffing, agencies, consulting, IT services, training and professional firms, so a services site classifies rather than falling through to `Unclassified`. Audience (`men`, `women`, `athletes`, `parents`, `seniors / 50+`, `pet owners`…) is scored separately, so "Skincare / Anti-aging, for men" is expressible.

Three properties make the call trustworthy rather than magic:

- **Weighted terms.** `testosterone booster` is worth 4; `energy` is worth almost nothing, because every brand on earth says it.
- **Capped repetition.** A single term contributes a bounded amount however often it appears, so breadth of evidence beats a keyword-stuffed product grid.
- **Auditable output.** Every row carries `classificationEvidence` (the terms that fired and how often), `classificationConfidence` 0-100, and `classificationAlternatives` (the runner-up niches) so a borderline call can be checked in seconds.

The full taxonomy and angle library are listed in [`docs/reference.md`](docs/reference.md), which is generated from the source (`npm run docs`) so it cannot drift.

Extend or override the taxonomy with `customTaxonomy` — it is merged over the built-in one sub-niche by sub-niche:

```json
{ "Gaming": { "Peripherals": { "terms": ["mechanical keyboard", ["gaming mouse", 4]], "audience": ["teens & young adults"] } } }
```

### 4. Research — what are they running in the Ad Library?

For each brand the actor builds search terms (`adSearchStrategy`):

- `brand` — the brand name only (cheapest);
- `brand+products` — brand name plus its product names (default);
- `products` — product names only.

Generic product names are automatically prefixed with the brand ("Daily Greens" → "Iron Peak Daily Greens") so a search does not come back full of competitors' ads. Gift cards, bundles and stub names are dropped.

Results from every term are merged, deduped by ad id, **ranked by exposure**, and only the top `adsPerBrand` go on to copy analysis — because "target the high-impression ones first" should mean the analysis budget lands on the ads that actually ran at scale.

### 5. Analyse — what angle is the copy running?

Each surviving ad's copy (title + body + link description + CTA) is broken down into:

| Dimension | What you get |
| --- | --- |
| **Angles** | Ranked hits from a library of 20 direct-response angles — problem/agitation, unique mechanism, authority/science, social proof, transformation, founder story, us-vs-them, curiosity, urgency/scarcity, offer/value, risk reversal, identity call-out, fear/warning, convenience, clean ingredients, aspiration, objection handling, seasonal, hero ingredient, customer voice/UGC — each with a confidence score **and the matched phrases as evidence**. |
| **Awareness stage** | Schwartz-style: `unaware` → `problem-aware` → `solution-aware` → `product-aware` → `most-aware`. |
| **Format** | `listicle`, `advertorial`, `testimonial`, `ugc-first-person`, `educational`, `direct-offer`, `story`, `short-copy`, `long-copy`. |
| **Hook** | The opening line verbatim, plus its type (`question`, `call-out`, `warning`, `statistic`, `curiosity-gap`, `first-person-story`, `comparison`…). |
| **Offers** | Discounts, BOGO, free shipping, free trial, subscription, bundle, guarantee, gift, limited-time — extracted verbatim. |
| **Emotional triggers** | frustration, fear, hope, embarrassment, pride, belonging, relief, desire, curiosity, anger, trust, urgency. |
| **Proof points & claims** | The numbers used as proof ("93%", "30 days", "12 studies") and the claim sentences that carry them. |
| **Readability** | Word count and Flesch reading ease — direct-response copy usually lands 60-80. |

All of it is deterministic: the same copy always yields the same analysis, which is what makes the cross-brand aggregation meaningful.

### 5b. Cross-intelligence — what is normal, and who breaks from it

Classification tells you what a brand *is*. This layer tells you what it is *relative to everyone else in the run*, which is the part you act on. None of it costs another request — it is all re-read from what was already fetched.

**Per brand, from its own page source:**

| Signal | What you get | Why it matters |
| --- | --- | --- |
| **Marketing stack** | ~55 tools across ad pixels, analytics, email, SMS, subscription, reviews, CRO, support, BNPL and affiliate, plus a 0-100 maturity score | A Meta + TikTok pixel means the brand buys traffic. Recharge means subscription is real. Okendo means it invests in review collection. None of this is claimed in the copy. |
| **Commerce shape** | price min/median/max, product count, subscription, free-shipping threshold, guarantee window, headline discount, review count and rating, press mentions, certifications, founding year | The numbers a competitor actually cares about, and directly comparable brand to brand. |

**Per brand, from its ads:**

| Signal | What you get |
| --- | --- |
| **Funnel destinations** | Where the clicks go — advertorial, listicle, quiz, PDP, collection, landing page, lead form, app store, off-site. Nobody publishes their funnel type; the destination URL gives it away. |
| **Creative velocity** | Launches per month, launches in the last 30 days, days since the newest ad, median and longest run length, active count, total variants. |
| **Scaling posture** | One word — `scaling`, `testing`, `steady`, `stale`, `absent` — with the reason. Often more actionable than the angle breakdown, because it says whether a brand is a live competitor or a coasting one. |
| **Media & platform mix** | Video vs image vs carousel; Facebook vs Instagram vs Audience Network. |

**Recurring language — what they actually say, over and over:**

| Output | What it answers |
| --- | --- |
| **Signature vocabulary** | The words and phrases a brand repeats *across* its ads, with the share of ads carrying each and the average exposure of those ads. |
| **Their words, not the category's** | Terms this brand over-indexes on versus the rest of its niche, with a lift multiple. |
| **Hook vs closing vocabulary** | The language that opens ads and the language that closes them, mined separately. |
| **Words per angle** | Which vocabulary the brand reaches for when it runs a given angle. |
| **Shared category language** | The phrases most brands in the niche use — the category's common tongue. |

The measure is **document frequency, not occurrence count**: a phrase used once in eight of ten ads is the brand's vocabulary; a phrase hammered twenty times inside one long advertorial is one ad's quirk. Counting occurrences ranks the second above the first and gets the whole question backwards.

Four rules keep the output readable rather than merely full: phrases never start or end on a function word (so "free shipping" survives and "shipping on" does not) and never end on a bare figure; they never cross a sentence boundary; a shorter term folds into a longer one containing it ("dosed" into "clinically dosed tongkat ali"); and two windows of the same phrase shifted by a word are reported once. The brand's own name and product names are excluded, or every brand's top term would be itself.

Distinctiveness is **leave-one-out**: a brand's own usage is excluded from the category baseline it is measured against. Include it and a brand can never look distinctive against a number it is itself inflating.

```
Language they repeat            In ads   Share   Avg exposure
  clinically dosed                   4  100.0%          73.6
  male vitality                      4  100.0%          73.6
  clinically dosed tongkat ali       2   50.0%          83.8
  tired of low energy                2   50.0%          79.4

Their words, not the category's: clinically dosed (20x) · third-party tested (10x)
Hook vocabulary:     tired of low energy · male vitality
Closing vocabulary:  shop now · trusted by 40000 men
```

**What they are scaling, and where the clicks go:**

| Output | What it answers |
| --- | --- |
| **Proven winners** | The ads past a survival threshold (60 days by default), what angle they share, and what funnel they feed. An advertiser switches off what does not work, so an ad still delivering after months has been paid for repeatedly — that survival is the strongest evidence available when Meta publishes no impressions. |
| **Pages they run** | Every distinct destination under the brand's own domain, ranked by the exposure invested behind it, with the funnel type and the angles driving traffic to each. A brand running twelve ads at four pages is running four funnels, not one. |
| **Split tests** | Sibling pages under one directory, and the same path with different query parameters — the brand's own A/B tests, visible here and nowhere else. |
| **Message match** *(opt-in)* | With `analyseLandingPages`, the actor opens each destination and reports its shape, headings, on-page price, guarantee, CTA count — and scores how much the page's own angles overlap the angles of the ads pointing at it. A low score behind heavy spend is a conversion leak. |

Tracking parameters are stripped when grouping, so one page reached by twelve ads is one row and not twelve; parameters that genuinely change the page (`?variant=b`) are kept.

```
What they are scaling — 3 ads past 60 days; every one runs Unique mechanism,
                        all pointing at an advertorial

Pages they run — 3 destinations, top page takes 50.0% of ads
  /blogs/news/why-men-lose-energy        advertorial    2 ads   exposure 167.5
  /blogs/news/the-real-reason-you-tired  advertorial    1 ad    exposure  68.3
  /products/daily-test                   product-page   1 ad    exposure  58.5

Looks like their own split tests
  /blogs/news — 2 variants (3 ads)
```

**Filtering to what scales.** `minExposureScore` drops ads below a score before analysis, so a floor of 60 returns the top ads that clear 60 rather than whatever survives inside an arbitrary first N. Note what this is not: **Meta publishes true impressions for political and issue ads only**, so on a commercial run this filters on EU reach, days running and creative variants — a better proxy for what a brand is scaling than impressions would be, because it measures survival rather than delivery.

**Across brands:**

| Output | What it answers |
| --- | --- |
| **Niche benchmark** | What is normal here: median price, guarantee, discount depth, review count, stack maturity, launches per month, and what share of the niche runs subscription / paid / reviews / BNPL. |
| **Category stack** | Which tools the niche has standardised on, by percentage of brands. |
| **Angle whitespace** | Angles the category barely runs — including the ones it runs *not at all*, which ranking what appeared would never surface. Suppressed below 10 ads, because with no data every angle reads as 0%. |
| **Deviations** | Per brand, where it breaks from its niche and why that matters, in a sentence. Suppressed for niches under 3 brands, where a "median" is just the brand itself. |
| **Creative competitors** | Which brands share this one's angle + format + awareness fingerprint. Two brands can sell different products and still fight over the same feed slot. |

A real example from a three-brand supplement run:

```
### Titan Labs
- Stack (0/100): nothing detected
- Commercials: median 199.5 · 2 products · 210 reviews

How it breaks from its niche
- Price (above): 199.5 vs 49 — prices 307% above the Supplements median
- Social proof volume (below): 210 vs 3100 — review count is below the category norm
- Subscription (absent): the category monetises on repeat purchase and this brand does not
- Paid media (absent): not set up to buy traffic while its competitors are
```

### 6. Report

- **Dataset** — one row per brand, with the full ad list and analysis nested.
- **`REPORT.json`** — the same data plus the cross-brand rollup.
- **`REPORT.md`** and **`REPORT.html`** — a readable report: niche map, angle leaderboard across all brands, highest-exposure ads overall, then a section per brand. The HTML is self-contained and needs no network to view.

---

## Read this before you trust the numbers

**Meta does not publish impressions for ordinary commercial ads.** This is a limitation of the Ad Library itself, not of this actor, and it is worth being precise about:

- `impressions` and `spend` are published **only for political and issue ads**, via the official API.
- For commercial ads, the official API only returns ads that **reached the EU**, where `eu_total_reach` is the exposure figure available.
- The public Ad Library web interface shows commercial ads worldwide but publishes **no impression figure at all**.

So the actor ranks by an **exposure score** (0-100, comparable within a single run) built from whichever signals an ad actually carries:

| Signal | Weight | Available when |
| --- | --- | --- |
| Impressions | 0.35 | political/issue ads only |
| EU audience reach | 0.30 | ad targeted the EU |
| Spend | 0.10 | political/issue ads only |
| Days running | 0.20 | almost always |
| Creative variants | 0.10 | provider-dependent |

Weights are renormalised over whichever signals are present, so a data-rich ad is not penalised against a data-poor one. **Longevity is the honest workhorse**: advertisers switch off ads that do not work, so an ad still running after three months is a winner even with no impression figure. But an ad carrying **no measured exposure figure at all is capped at 85**, so an inference can never outrank a published number.

Every ad reports `exposure.signals` (what was actually available) and `exposure.basis` (a plain-English justification like `EU reach 1.4M; running 140 days; still active`). Nothing is presented as a measurement when it is an inference.

---

## Ad Library providers

| Provider | Covers | Needs | Notes |
| --- | --- | --- | --- |
| `apify-actor` | **Commercial ads worldwide** | Apify token (automatic on the platform) | Delegates to `apify/facebook-ads-scraper` (or any actor you name). This is what most users want. |
| `meta-graph` | Political/issue ads anywhere; all ads for **EU-targeted** campaigns | `metaAccessToken` | The official API. Add an EU code such as `DE` or `FR` to `adCountries` or it can only return political ads. |
| `none` | — | — | Classification only, no ad research. |
| `auto` (default) | — | — | Picks `apify-actor` if an Apify token is present, else `meta-graph` if a Meta token is set, else `none`. |

**On cost:** the `apify-actor` provider makes **one nested actor run per brand**, not one per search term — every term for a brand goes into a single run. Concurrency is capped at 3 for this provider. If you are watching compute units, `adSearchStrategy: "brand"` roughly halves the work.

Different ad-library actors emit different field names, so records are normalised against families of field names rather than one fixed schema, and `adsApifyActorInput` is merged last into the nested actor's input so any actor-specific option wins.

---

## Optional LLM enrichment

Off by default — the actor is fully deterministic without it. With `useLlm: true` and an `llmApiKey` (or `ANTHROPIC_API_KEY` in the environment), a model runs **on top of, never instead of**, the rule-based pass:

1. it sanity-checks each niche call against the allowed taxonomy, and
2. it writes a plain-language summary of the angle strategy across a brand's top ads.

Any change is recorded in `llmNote` so it is visible rather than silent, and every LLM failure is swallowed — a bad key or a rate limit degrades the run to the rule-based result, it never fails it.

---

## Usage

### Input

`startUrls` is the only required field. Everything else has a working default.

```json
{
  "startUrls": [{ "url": "https://example.com/best-mens-supplement-brands" }],
  "maxBrands": 25,
  "profileDepth": "standard",
  "adsProvider": "auto",
  "adCountries": ["US"],
  "adSearchStrategy": "brand+products",
  "adsPerBrand": 20,
  "rankBy": "composite",
  "proxyConfiguration": { "useApifyProxy": true }
}
```

More examples in [`examples/`](examples/). The full field list with descriptions is in [`.actor/input_schema.json`](.actor/input_schema.json).

A proxy is strongly recommended: brand sites and the Ad Library both rate-limit datacenter IPs.

### Output

One dataset row per brand:

```json
{
  "brandName": "Iron Peak Labs",
  "domain": "ironpeak.com",
  "niche": "Supplements",
  "subNiche": "Men's health",
  "audience": "men",
  "classificationConfidence": 78,
  "classificationEvidence": [{ "term": "testosterone booster", "hits": 3, "weight": 4 }],
  "classificationAlternatives": [{ "niche": "Supplements", "subNiche": "Sports & performance", "confidence": 41 }],
  "platform": "shopify",
  "products": [{ "name": "Daily Test", "price": 49, "url": "https://ironpeak.com/products/daily-test" }],
  "adCount": 18,
  "adQueries": ["Iron Peak Labs", "Iron Peak Labs Daily Test"],
  "exposureScore": 61.4,
  "topAngle": "problem-agitation",
  "angleBreakdown": [
    { "angle": "problem-agitation", "label": "Problem / agitation", "adCount": 11, "share": 61.1, "avgExposure": 68.2 }
  ],
  "awarenessBreakdown": [{ "stage": "problem-aware", "adCount": 9, "share": 50 }],
  "formatBreakdown": [{ "format": "ugc-first-person", "adCount": 7, "share": 38.9 }],
  "topHooks": [{ "hook": "Tired of low energy at 40?", "exposure": 84.1, "snapshotUrl": "https://…" }],
  "commonOffers": [{ "kind": "discount-percent", "detail": "25% off", "count": 6 }],
  "ads": [{ "…": "full ad record, exposure score and copy analysis" }],
  "notes": []
}
```

Plus `REPORT.json`, `REPORT.md` and `REPORT.html` in the key-value store.

### Running it locally

```bash
npm install
npm test          # validates the input schema, then 272 tests (loopback HTTP only)
npm run build
npm start
npm run docs      # regenerate docs/reference.md from the source
npm run validate  # Apify input/dataset schema check on its own
```

For a local run, put your input in `storage/key_value_stores/default/INPUT.json`. To push to the platform, `apify push`.

### Running it on the platform from your terminal

Once the actor is built on Apify, this starts a run, waits for it and downloads the report:

```bash
export APIFY_TOKEN=...                       # from Apify Console → Settings → API tokens
node scripts/run-remote.mjs --url https://example.com --mode single-brand --strategy brand
```

It writes `out/REPORT.md`, `out/REPORT.html`, `out/REPORT.json` and `out/dataset.json`, and prints one line per brand. Add `--dry-run` to print the input it would send without touching the network, `--ads none` to skip ad research, `--countries US,GB,DE` to widen the Ad Library search, and `--actor <actorId>` if the name does not resolve.

The token is read from the environment only, never from an argument, so it stays out of your shell history and out of `ps`.

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| No brands discovered | Set `brandLinkSelector` to the region of the page that lists them (e.g. `.article-body`), or `discoveryMode: "single-brand"` if the page *is* the brand. |
| A retailer or blog was picked up as a brand | Add it to `excludeDomains`, or use `includeDomains` as a strict allowlist. |
| Brands classified as `Unclassified` | The site copy is thin (heavy JS, splash page). Try `profileDepth: "deep"`, lower `minClassificationConfidence`, or add terms via `customTaxonomy`. |
| No ads for any brand | Check the provider is configured, that `adCountries` covers where these brands advertise, and that the brand name matches their Meta *page* name — many brands advertise under a trading name. |
| Ads returned but all exposure scores are low | Normal outside the EU: with no published reach figure the score rests on longevity alone and is capped at 85. Add an EU country to `adCountries` for reach data. |
| Nested ad actor returns items but none are parsed | That actor's output shape is unusual — inspect its dataset and map fields via `adsApifyActorInput`. The warning in the run report names the actor and the item count. |

---

## Project layout

```
src/
  main.ts                  five-stage orchestrator
  input.ts                 input parsing, validation, provider resolution
  discovery/               brand extraction and scoring from a source page
  profile/                 brand site fetching, JSON-LD / meta / Shopify extraction,
                           marketing-stack and commerce-signal detection
  classify/                weighted taxonomy + classifier
  ads/                     provider interface, Meta Graph + Apify providers,
                           record normalisation, exposure scoring, research loop
  analyze/                 angle library, copy analyser, funnel + velocity signals,
                           recurring-language mining
  llm/                     optional Anthropic enrichment
  report/                  dataset rows, niche benchmarks, deviations, competitor
                           similarity, Markdown + HTML renderers
  util/                    domain, text, HTTP and proxy-session helpers
tests/                     272 tests including an end-to-end run over local HTTP
scripts/                   docs generator, and a one-command platform runner
```

## Legal

This actor reads publicly available web pages and the public Meta Ad Library, which exists specifically to make advertising transparent. Respect each site's terms and `robots.txt`, keep concurrency civil, and use the output for market research rather than for republishing someone else's copy.

## Licence

MIT — see [LICENSE](LICENSE).
