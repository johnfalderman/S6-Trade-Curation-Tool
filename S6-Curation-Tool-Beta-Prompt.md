# Society6 Curation Tool BETA — Full Project Context & Feature Prompt

## What This App Is

An internal wall art curation tool for Society6's trade team. The workflow: a team member pastes a Jotform client brief (hotel, restaurant, office needing wall art) → AI parses the brief → scores and selects artwork from the S6 catalog → generates a PowerPoint deck of recommendations. It's deployed on Netlify.

We're evolving this into **Society6 Curation Tool BETA** — expanding product type support, adding a "find similar" workflow, and making results shareable and exportable beyond PowerPoint. The app title should be updated to reflect the new name.

## Tech Stack

- **Frontend:** React 18 + Next.js 14.2.3 (App Router), Tailwind CSS 3.3
- **Backend:** Next.js API routes (serverless)
- **AI:** Anthropic Claude API (currently claude-haiku-4-5-20251001) — used for brief parsing + curatorial artwork selection
- **Data:** Netlify Blobs for catalog persistence, PapaParse for CSV, pako for gzip compression
- **Export:** pptxgenjs for PowerPoint generation
- **Deployment:** Netlify with @netlify/plugin-nextjs

## Key Files

- `app/page.jsx` — Main UI: intake form, results display (Primary Collection, Accent & Alternates, Gallery Wall Sets), refinement loop
- `app/catalog/page.jsx` — Catalog upload/management
- `app/api/recommend/route.js` — The brain: brief parsing (Claude or regex fallback), catalog scoring, Claude curatorial selection, deduplication, feedback/refinement handling
- `app/api/slides/route.js` — PowerPoint generation endpoint
- `app/api/catalog/route.js` — Catalog CRUD via Netlify Blobs
- `lib/parser.js` — Rule-based brief parsing (regex fallback)
- `lib/tagger.js` — Tags catalog records with style/mood/palette/subject
- `lib/recommender.js` — Legacy scoring engine (NOT currently used — scoring is inline in recommend/route.js)
- `lib/slides.js` — PowerPoint generation logic (pptxgenjs)
- `data/sample-catalog.json` — 51 demo records
- `tailwind.config.js` — S6 brand colors: dark (#1a1a1a), accent/red (#e84855), light (#f5f5f0)

## How the Recommendation Engine Works

1. **Brief Parsing:** Claude extracts structured fields (projectName, clientName, styleTags, paletteTags, avoidTags, rooms, searchKeywords, subjectMustMatch) from freeform Jotform text. Falls back to regex if Claude fails.
2. **Optional Moodboard:** PDF extraction (pdf-parse) or URL scraping (Pinterest/Houzz) — best-effort, failures swallowed silently.
3. **Catalog Tagging:** Each record tagged via regex on title + image_alt + product_handle + source_collection. 9 subject categories (music, coastal, floral, landscape, urban, animal, southern, typography, abstract).
4. **Scoring:** Style match (+3), palette match (+2), keyword hits (+4), key themes (+2), subject mismatch (-15), avoid tags (-8).
5. **Claude Curatorial Selection:** Top 200 scored candidates sent to Claude Haiku, which picks 20 with reasons. Falls back to top-scored if Claude fails.
6. **Results:** Primary Collection (12-20 pieces), Accent & Alternates (8-15), Gallery Wall Sets (3 sets of 6, if requested).
7. **Refinement Loop:** User feedback → Claude extracts add/avoid keywords → merged into brief → re-scored → re-selected.
8. **Pinned Items:** User can force-include specific S6 product URLs across refinements.

## Design & Styling

- Tailwind utility classes + custom component classes in globals.css
- S6 brand palette: dark gray (#1a1a1a), red accent (#e84855), warm off-white (#f5f5f0)
- System font stack, responsive grid (2→4 cols), dark header/footer with light content area
- Custom classes: .btn-primary, .btn-secondary, .btn-accent, .card, .tag, .section-header

## Environment Variables

```
ANTHROPIC_API_KEY — Required for Claude-powered parsing/selection (regex fallback if missing)
GOOGLE_SERVICE_ACCOUNT_KEY — Legacy, not used in current flow
GOOGLE_DRIVE_FOLDER_ID — Legacy, not used
NEXT_PUBLIC_APP_NAME — "S6 Trade Curation Tool"
```

## Workspace

The codebase is in the folder at `/Users/johnalderman/Desktop/S6-Trade-Curation-Tool/S6 Trade Curation Tool/`. Note the nested folder structure — the actual Next.js project is one level deep.

## Known Issues & Cleanup Needed

- Debug console.log statements in recommend/route.js (lines ~538-539) should be removed or made conditional
- Stale "CHANGE 3" comment suggests upgrading to Sonnet but code uses Haiku
- Google Slides API references in README and .env.example are legacy — app now uses pptxgenjs for PowerPoint export
- `lib/recommender.js` is unused dead code (scoring logic was moved inline to the API route)
- No error recovery UI — if Claude fails, fallbacks happen silently with no user feedback
- PDF moodboard has a hardcoded 4-second timeout with no UI indication if it fails
- Pinned item URL matching is fragile (string comparison vs. proper URL parsing)
- Magic numbers throughout scoring (200-item pool, -15 penalty, etc.) — not configurable
- No unit tests
- Gallery Wall set generation is simplified (just takes sequential items) vs. the more sophisticated cohesion logic in the unused recommender.js

---

## NEW FEATURES TO BUILD

### 1. Product Type Filtering

The intake form needs options that let users control which product categories are included in results. These should be clear, simple toggles or checkboxes — not buried in settings:

- **Exclude wooden wall art** — remove wooden wall art from results (wood-mounted prints, wood wall art, etc.)
- **Include throw pillows** — add throw pillows to the recommendation pool
- **Wall prints only** — filter results to just wall prints (a subset of wall art)
- **Posters only** — filter results to just posters (another subset of wall art)

These filters need to work with the existing catalog tagging system. The catalog records have a `source_collection` field (values like "art-prints", "canvas-prints", etc.) that can be used to distinguish product types. If new product types like throw pillows aren't currently in the catalog schema, the system should be extended to support them.

The UI should make it obvious that some options are mutually exclusive (e.g., "posters only" and "wall prints only" can't both be active).

### 2. "Find Similar" via Product URLs

Users should be able to paste one or more Society6 product URLs — as many as they want — and have the system find catalog items that are visually and stylistically similar to those products, including the pasted products themselves in the results.

This is different from the existing "pinned items" feature (which just force-includes specific URLs). This feature should:

- Accept any number of S6 product URLs
- Analyze those products' style, palette, subject matter, and mood
- Use those attributes as the basis for scoring and selecting similar items from the catalog
- Include the original pasted products in the final results
- Work as a standalone mode (no Jotform brief needed) OR as a supplement to a brief

This is essentially a "more like this" discovery tool built on top of the existing scoring engine.

### 3. CSV Export with Images and Links

In addition to the existing PowerPoint export, users should be able to export their curated results as a CSV file. Each row should include:

- Product title
- Product URL (full Society6 link)
- Image URL (the product image)
- Thumbnail or image reference (embedded or linked so it's visible when opened in Excel/Sheets)
- Style/palette/subject tags
- Which collection it was placed in (Primary, Accent & Alternates, Gallery Wall Set #)

The CSV should be downloadable from the results view alongside the existing PowerPoint export button.

### 4. Shareable Results Page

Users should be able to share their curated results as a standalone webpage — no login required, just a link.

- Generate a shareable URL from the results view
- The shared page should display the curated artwork in a clean, presentable grid layout
- Include product images, titles, and clickable links to the Society6 product pages
- Organized by collection (Primary, Accent & Alternates, Gallery Wall Sets)
- Should look polished enough to share with a client or colleague
- Include the project name and client name as a header

This could be implemented as a static page with the results data encoded in the URL (for small result sets) or stored temporarily (Netlify Blobs, same as the catalog) with a generated ID.

---

## Implementation Notes

- The app is React/Next.js with Tailwind — keep all changes consistent with the existing patterns
- The existing scoring engine in `app/api/recommend/route.js` is the foundation — extend it rather than replacing it
- The catalog tagging system in `lib/tagger.js` may need new tags/categories for non-wall-art products
- Keep the S6 brand styling: dark (#1a1a1a), red accent (#e84855), warm off-white (#f5f5f0)
- The app deploys to Netlify — any new features need to work within that serverless/edge function model
- Claude API (Anthropic) is already integrated for brief parsing and curatorial selection — leverage it for the "find similar" feature's product analysis
