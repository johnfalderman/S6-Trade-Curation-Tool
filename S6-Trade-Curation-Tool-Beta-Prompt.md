# Society6 Curation Tool BETA — Implementation Prompt

## Project Context

Read the file `S6-Trade-Curation-Tool-Context-Prompt.md` in this same folder for full technical context on the existing app — tech stack, file structure, how the recommendation engine works, known issues, etc.

The codebase lives at `/Users/johnalderman/Desktop/S6-Trade-Curation-Tool/S6 Trade Curation Tool/` (note the nested folder).

## What We're Building

This is a BETA evolution of the existing S6 Trade Curation Tool. The app currently only handles wall art. We're expanding product type support, adding a "find similar" workflow, and making results shareable and exportable beyond PowerPoint.

The app title should be updated to **Society6 Curation Tool BETA**.

---

## New Features

### 1. Product Type Filtering

The intake form needs options that let users control which product categories are included in results. These should be clear, simple toggles or checkboxes — not buried in settings:

- **Exclude wall art** — remove wall art from results entirely (for when the client only wants decor/accessories)
- **Include throw pillows** — add throw pillows to the recommendation pool
- **Wall prints only** — filter results to just wall prints (a subset of wall art)
- **Posters only** — filter results to just posters (another subset of wall art)

These filters need to work with the existing catalog tagging system. The catalog records have a `source_collection` field (values like "art-prints", "canvas-prints", etc.) that can be used to distinguish product types. If new product types like throw pillows aren't currently in the catalog schema, the system should be extended to support them.

The UI should make it obvious that some options are mutually exclusive (e.g., "exclude wall art" and "wall prints only" can't both be active).

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
