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
npm test          # 162 tests; only loopback HTTP, no internet needed
npm run build
npm start
npm run docs      # regenerate docs/reference.md from the source
```

For a local run, put your input in `storage/key_value_stores/default/INPUT.json`. To push to the platform, `apify push`.

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
  profile/                 brand site fetching, JSON-LD / meta / Shopify extraction
  classify/                weighted taxonomy + classifier
  ads/                     provider interface, Meta Graph + Apify providers,
                           record normalisation, exposure scoring, research loop
  analyze/                 angle library, copy analyser
  llm/                     optional Anthropic enrichment
  report/                  dataset rows, run rollup, Markdown + HTML renderers
  util/                    domain, text, HTTP helpers
tests/                     162 tests including an end-to-end run over local HTTP
scripts/                   generates docs/reference.md from the source
```

## Legal

This actor reads publicly available web pages and the public Meta Ad Library, which exists specifically to make advertising transparent. Respect each site's terms and `robots.txt`, keep concurrency civil, and use the output for market research rather than for republishing someone else's copy.

## Licence

MIT — see [LICENSE](LICENSE).
