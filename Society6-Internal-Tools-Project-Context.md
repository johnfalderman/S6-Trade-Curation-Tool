# Society6 Internal Tools — Project Context & Handoff

*This document is the standing context for the **Society6 Internal Tools** Project in Claude Teams. It frames the program, summarizes the products built so far, and provides everything a fresh Claude conversation needs to pick up the work.*

---

## The program

**Society6 Internal Tools** is an ongoing exploration of where AI-powered internal tooling could meaningfully accelerate the Society6 business. The bet is that Society6 — a million-product, taste-driven marketplace — has internal workflows that are bottlenecked by manual effort and shallow catalog understanding, and that small, focused tools built with modern AI infrastructure can unlock significant productivity and strategic value without needing to be production-grade software.

This is a program, not a single deliverable. Each product in the program is scoped narrowly enough to be built quickly, evaluated honestly, and either expanded into something Society6 engineering productionizes or retired. The goal is to learn fast about where AI tools deliver real leverage, and to put working artifacts in front of internal stakeholders to make the conversation tangible.

---

## Products built so far

### 1. Trade Curation Tool

A workflow tool for Society6's **trade team** — the team that handles B2B requests from interior designers, hospitality, hotels, restaurants, offices, and other clients looking for curated art at scale. The tool takes a client brief and returns a curated set of recommendations the team can turn into a client-facing presentation, dramatically faster than doing it by hand.

**Why it matters:** Today, trade curation is slow, manual, and bottlenecked by how well any single team member knows the catalog. The hypothesis is that with the right catalog metadata and a brief-matching recommendation engine, the trade team can go from brief to recommendation set in minutes instead of hours, with broader catalog coverage than any single curator could hold in their head.

**Live at:** https://s6-trade-curation.netlify.app

**Status:** Working prototype. Brief-input UI, vision-aware recommendation scoring, and a curated-results view are all functional and demoable. The natural next step is adding a presentation-output capability so the curated selection can be exported as a client deliverable (PDF or slide deck).

### 2. Catalog Enhancement

A data infrastructure capability — and a reusable dataset — produced by running Claude vision against Society6's wall art catalog and writing structured metadata back to each product. This is the data foundation the Trade Curation Tool depends on, but the data has strategic value across the broader Society6 business well beyond that one workflow.

**Why it matters:** Society6's value proposition is taste-driven discovery, but the catalog metadata under the hood is keyword-thin and artist-supplied (i.e. inconsistent). Adding structured vision metadata — style, mood, palette, subject, keywords, visual summary — is the missing ingredient for aesthetic search, real visual-similarity recommendations, AI-generated descriptions for SEO, long-tail paid search expansion, and richer product detail pages.

**What was built:**
- A batched, resume-safe enrichment endpoint with a progress UI
- A sample-logging panel for ongoing quality spot-checks
- CSV / JSON export endpoints, ingestible directly into Society6 tooling
- Admin gating (catalog page footer-linked only, with a "FOR ADMINISTRATOR ONLY" banner)

**The dataset:**
- **39,584 of 42,967** wall art products enriched (~92%)
- The ~3,383 stragglers have missing or broken `image_url` values — a data-quality issue in Society6's source catalog, not a tool bug
- Fields per product: `visionSummary`, `visionSubject`, `visionStyle`, `visionPalette`, `visionMood`, `visionKeywords`
- Exportable from the live `/catalog` page

**Cost:** ~$80–100 in Claude Haiku API spend for the full pass over the wall art catalog. Cost scales linearly if extended to the rest of the catalog.

**Status:** Working. Enrichment pass complete on wall art. Export endpoints functional. Open threads: sharing the dataset with a Society6 PM (in motion), extending enrichment beyond wall art, deploying the data across consumer-facing surfaces.

### Future products

This section is intentionally open. As new internal-tool concepts get prototyped, they should be added here with the same structure: what it is, why it matters, where it lives, status.

---

## Strategic documents (downstream of the Catalog Enhancement product)

These docs articulate how the enriched dataset could be deployed across the Society6 business beyond the Trade Curation Tool. They live in this Project because they're the artifacts used to pitch the data work internally.

- **Vision-Data-Strategy.md** — the strategic playbook for the enriched dataset: highest-ROI deployments across site experience, marketing, and paid advertising. Recommends prioritizing AI-generated alt text + aesthetic search as the two compounding wins.
- **Product-Page-Vision-and-Principles.md** — what the ideal vision-enriched Society6 PDP should look like, framed as principles and rules to follow rather than a build spec. Includes the audience hierarchy (shoppers > artists > search engines > AI engines) and ten core principles.
- **Product-Page-V1-Spec.md** — an earlier, more prescriptive build-spec version of the PDP doc. Useful if you actually want to prototype the page in Shopify. Mostly superseded by the principles doc above.

---

## Shared infrastructure

Both products built so far live in the same Next.js app, deployed together on Netlify. This is intentional for the prototype phase — it keeps the cost of building each new tool low because the codebase, deployment, and catalog data are already in place. If any individual product gets productionized by Society6 engineering, that team would likely separate it from this shared scaffolding.

### Where things live

**On disk**
- `/Users/johnalderman/Desktop/S6-Trade-Curation-Tool/` — root project folder
- `/Users/johnalderman/Desktop/S6-Trade-Curation-Tool/S6 Trade Curation Tool/` — the Next.js app code
- Strategy docs and this handoff doc sit in the root folder

**Online**
- Live app: **https://s6-trade-curation.netlify.app** (Trade Curation Tool front-end)
- Admin catalog UI with enrichment + export: **https://s6-trade-curation.netlify.app/catalog**
- Netlify deployment: currently on John's personal Netlify account
- GitHub repo: currently in John's personal GitHub *(intentionally — see "Ownership" below)*

**Key files inside the codebase**
- `app/page.jsx` — the trade team's brief input / recommendation interface
- `app/api/recommend/route.js` — vision-aware recommendation scoring against the brief
- `app/api/catalog/enrich/route.js` — the vision enrichment endpoint (GET status, POST batch)
- `app/api/catalog/export/route.js` — CSV / JSON export endpoint
- `app/api/catalog/route.js` — catalog read/write, includes enrichment status in responses
- `app/catalog/page.jsx` — admin catalog UI with enrichment progress + exports

### Technical stack
- Next.js 14 (App Router) deployed on Netlify
- React 18 + Tailwind CSS
- Netlify Blobs for catalog persistence (store: `catalog`; keys: `records`, `meta`, `enrichment-meta`, `enrichment-samples`)
- Anthropic Claude API (`claude-haiku-4-5-20251001`) for vision analysis
- Environment variable: `ANTHROPIC_API_KEY` set on Netlify

---

## Open threads across the program

1. **Demo the Trade Curation Tool to the Society6 trade team** — the live app is the artifact
2. **Hand the enriched dataset to a Society6 PM** — the flat file export is downloadable from the live `/catalog` page
3. **Add presentation-output to the Trade Curation Tool** — turn the on-screen curated selection into a client-ready PDF or slide deck
4. **Extend Catalog Enhancement beyond wall art** — same approach should work for the rest of Society6's catalog; cost scales linearly
5. **Pitch the broader data play internally** — strategy docs are the artifacts; alt text + aesthetic search on the consumer site is the recommended lead
6. **Prototype the vision-enriched PDP** — on the Shopify sandbox; metadata already flowed in
7. **Identify the next internal tool to prototype** — the program is meant to keep expanding
8. **Long-term ownership** — for any tool that earns it, decide whether Society6 engineering adopts the codebase, just consumes the data output, or both

---

## Ownership and account context (read this before "moving" anything)

The program is being run from John's personal accounts. Specifically:

- **GitHub repo**: John's personal account. *Doesn't need to be transferred to Society6 unless Society6 engineering adopts a codebase.* Claude Teams doesn't care about GitHub ownership.
- **Netlify deployment**: John's personal Netlify. If Society6 engineering wants to host any of these tools, they'd redeploy from the repo under a Society6 Netlify team with a Society6 Anthropic API key.
- **Anthropic API key**: Currently John's personal key paid the Catalog Enhancement run. Future enrichment runs (e.g. extending beyond wall art, monthly refreshes) and any new tools that call Claude should use a Society6-paid key.
- **Claude Teams**: The right place for *new conversations* about this program. This doc plus the strategy docs as Project knowledge gives any future Claude session full context.

The cleanest mental model: **code is portable, data is portable, Claude conversations are not.** Everything substantive from the work to date has been captured in this handoff doc plus the strategy docs, so the loss-of-context cost of moving to Teams is essentially zero.

---

## How to pick this up cold

If you're a future Claude reading this for the first time, the fastest way to get oriented:

1. Read this doc — you now know the program framing, what's been built, and what's open
2. Read `Vision-Data-Strategy.md` — explains the value of the Catalog Enhancement dataset beyond just the Trade Curation Tool
3. Read `Product-Page-Vision-and-Principles.md` — explains how the data should show up to users on Society6 product pages
4. Explore the codebase only if the task at hand requires it

If you're a human (PM, designer, engineer, or trade team lead at Society6) reading this for the first time, the same three docs in the same order will give you the full picture in about 20 minutes. The live tool at s6-trade-curation.netlify.app is the demo of the trade workflow. The CSV export from the `/catalog` page is the data deliverable, which can be handed off to product, marketing, or paid teams independent of the tool itself.

---

## A note on what this program is *not*

These are working prototypes, not production systems. They run against snapshots of Society6's catalog, live on personal infrastructure, and are deliberately scoped to demonstrate value rather than handle scale. The point of the program is to make the case for productionizing the pieces that earn it — which would be separate projects, owned by Society6 engineering.

What does generalize beyond any individual prototype is the underlying insight: **AI infrastructure makes a new class of internal tooling cheap to prototype**, and Society6 has a number of workflows where that's likely to pay off. The Trade Curation Tool and the Catalog Enhancement are the first two examples. The program exists to find the next ones.
