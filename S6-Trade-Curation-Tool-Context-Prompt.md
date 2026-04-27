# S6 Trade Curation Tool — Project Context & Improvement Brief

## What This App Is

An internal wall art curation tool for Society6's trade team. The workflow: a team member pastes a Jotform client brief (hotel, restaurant, office needing wall art) → AI parses the brief → scores and selects artwork from the S6 catalog → generates a PowerPoint deck of recommendations. It's deployed on Netlify.

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
