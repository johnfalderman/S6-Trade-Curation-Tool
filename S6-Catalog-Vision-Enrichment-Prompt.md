# Society6 Catalog Vision Enrichment — Implementation Prompt

## Goal

Build a batch process that uses Claude Vision to analyze every product image in the Society6 catalog and store rich visual metadata (style, palette, subject, mood, composition) alongside each record. This replaces the current regex-based tagging system (`tagRecord`) with actual visual understanding of the artwork, dramatically improving recommendation quality across the entire app — not just Find Similar.

## Why This Matters

The current system tags catalog records by running regex patterns against text fields (title, image_alt, product_handle). Society6's text metadata is inconsistent and sparse — a black-and-white cocktail line drawing might just be titled "Cheers" with no useful alt text. The regex tagger would miss it entirely. Vision analysis looks at the actual image and produces accurate, rich descriptions regardless of how the artist titled it.

We already built vision analysis for the Find Similar feature's seed images (analyzes up to 8 images per request). This task extends that same approach to the entire catalog as a pre-processing step.

## Codebase Location

The project lives at `/Users/johnalderman/Desktop/S6-Trade-Curation-Tool/S6 Trade Curation Tool/` (note the nested folder — the actual Next.js project is one level deep).

## Tech Stack

- React 18 + Next.js 14.2.3 (App Router), Tailwind CSS 3.3
- Anthropic Claude API (currently claude-haiku-4-5-20251001) — already integrated
- Netlify Blobs for catalog persistence (key: `records` in store `catalog`)
- Deployment: Netlify with @netlify/plugin-nextjs

## Key Files You'll Need

- `app/api/recommend/route.js` — Contains `tagRecord()` (the regex tagger at ~line 530), `scoreRecord()` (uses the tags for scoring at ~line 610), `analyzeImagesWithVision()` (the existing vision analysis function at ~line 164 that we built for Find Similar seeds — reuse this pattern), and the subject/style tag constants including `SUBJECT_TAGS`
- `app/api/catalog/route.js` — Catalog CRUD: POST receives compressed CSV, expands to records, stores in Netlify Blobs. GET returns metadata. Records are stored as JSON string under blob key `records`
- `app/catalog/page.jsx` — Catalog management UI: upload CSV, see status. This is where the enrichment trigger UI should live
- `lib/tagger.js` — Legacy tagger module (not currently used — tagging is inline in recommend/route.js)

## How the Catalog Currently Works

1. User uploads `listing_records.csv` via the `/catalog` page
2. CSV is parsed in-browser (PapaParse), compressed (pako gzip), base64-encoded, and POSTed to `/api/catalog`
3. The API expands the compact format into full records with fields: `title`, `product_url`, `product_handle`, `source_collection`, `image_url`, `image_alt`
4. Records are stored as a JSON string in Netlify Blobs under store `catalog`, key `records`
5. At recommendation time, `tagRecord()` runs regex patterns on each record's text fields to produce `style[]` and `palette[]` arrays — these are ephemeral (computed per-request, not stored)

## What to Build

### 1. Vision Enrichment API Endpoint

Create a new API route `app/api/catalog/enrich/route.js` that:

- Reads the current catalog from Netlify Blobs
- Processes records in batches (to avoid timeouts and rate limits)
- For each record, fetches its `image_url` and sends it to Claude Vision
- Claude Vision returns structured tags per image (not a group analysis like Find Similar does — here each image gets its own analysis)
- Stores the enriched records back to Netlify Blobs with the vision tags attached to each record

**Per-image vision prompt should return:**
```json
{
  "visionStyle": ["line-art", "vintage", "illustration", "hand-drawn"],
  "visionPalette": ["black", "white", "bw", "monochrome"],
  "visionSubject": ["food-drink"],
  "visionMood": ["playful", "sophisticated", "retro"],
  "visionKeywords": ["cocktail", "martini", "cheers", "bar", "drinks", "vintage", "ink", "sketch"],
  "visionSummary": "Black and white line drawing of vintage cocktail glasses with retro typography"
}
```

Use `vision`-prefixed fields so they don't collide with the existing regex-generated `style` and `palette` fields. This lets us compare and gradually transition.

**Batch processing considerations:**
- Process 5-10 images concurrently (not all at once — respect rate limits)
- Use a batch size parameter (default 50) so the endpoint can be called multiple times
- Track progress: store an `enrichment-meta` blob with `{ totalRecords, enrichedCount, lastProcessedIndex, status, startedAt, updatedAt }`
- Skip records that already have `visionStyle` (idempotent — safe to re-run)
- Each batch should complete within Netlify's function timeout (default 10s on free tier, 26s on pro). If this is too tight, consider making batches smaller (10-20) or using background functions
- Handle image fetch failures gracefully — log and skip, don't fail the batch
- Total catalog might be 5,000-15,000 records. At ~$0.005-0.01 per image with Haiku vision, full enrichment costs roughly $25-150

### 2. Update Scoring to Use Vision Tags

Modify `scoreRecord()` in `app/api/recommend/route.js` to prefer vision tags when available:

- If a record has `visionStyle`, use it instead of (or in addition to) the regex-generated `style` array
- If a record has `visionPalette`, use it instead of `palette`
- If a record has `visionSubject`, use it for subject-mismatch detection (the `-15` penalty logic)
- If a record has `visionKeywords`, match those against brief.searchKeywords for bonus scoring
- Fall back to the regex `tagRecord()` output for records that haven't been vision-enriched yet

This means enrichment is incremental — the app works fine with partially enriched catalogs.

### 3. Enrichment UI on the Catalog Page

Add to `app/catalog/page.jsx`:

- An "Enrich with Vision" button that appears when a catalog is loaded
- Progress indicator showing: X of Y records enriched, estimated time remaining, estimated API cost
- Ability to pause/resume (since it processes in batches via repeated API calls)
- Status display: "Not enriched", "Partially enriched (2,340 / 8,500)", "Fully enriched"
- The button should trigger batch calls to the enrichment API in a loop from the client, with a progress bar updating after each batch

### 4. Enrichment Status in the Main UI

On the main curation page (`app/page.jsx`), show a small indicator near the catalog size info (where it currently says "catalog of X"):
- "catalog of 8,500 (vision-enriched)" or "catalog of 8,500 (2,340 enriched)" so users know the quality of results depends on enrichment status

## Architecture Decision: Per-Image vs. Batch Analysis

For Find Similar seeds, we send multiple images in one Claude call and ask for a group analysis. For catalog enrichment, **each image should get its own analysis** — we want per-record tags, not a group summary. However, to save on API overhead, you could batch 3-5 images per Claude call and ask for individual analyses of each (keyed by index). This cuts the number of API calls by 3-5x while still getting per-image results.

## Existing Vision Analysis Pattern to Reuse

The `analyzeImagesWithVision()` function in `app/api/recommend/route.js` (line ~164) shows the working pattern for:
- Fetching images as base64 with timeouts
- Building the Claude Vision content array (image blocks + text prompt)
- Parsing the JSON response
- Error handling and fallbacks

Adapt this pattern for the per-image catalog enrichment.

## Environment Variables

```
ANTHROPIC_API_KEY — Already set in Netlify. Used for all Claude calls including vision.
```

No new env vars needed.

## Important Constraints

- Netlify serverless function timeout: 10s (free) or 26s (pro). Batch sizes must complete within this window.
- Netlify Blobs has no size limit per blob, but JSON.stringify of 15K enriched records could be large. Consider whether storing enriched records as a separate blob (key: `records-enriched`) makes sense vs. merging into the existing `records` blob.
- Image URLs in the catalog use the format: `/products/handle-name` (relative) or include `?width=400` query param. Make sure to construct full URLs and handle both formats.
- The catalog page currently strips query strings from image URLs and re-adds `?width=400`. Use small image widths (300-400px) for vision analysis to keep token costs down — Claude doesn't need high-res to identify style and subject.
- Rate limiting: Anthropic's API has rate limits. Add retry logic with exponential backoff for 429 responses.

## Deployment

Same as existing app — push to GitHub, Netlify auto-deploys. No build config changes needed.

## Testing

After building, test with:
1. Upload a small test catalog (the sample-catalog.json has 51 records with placeholder images — you may want to test with a handful of real S6 product images instead)
2. Run enrichment on 10-20 records
3. Verify the enriched tags appear on the records in Netlify Blobs
4. Run a recommendation and confirm scoring uses vision tags when available
5. Check that un-enriched records still work with regex fallback
