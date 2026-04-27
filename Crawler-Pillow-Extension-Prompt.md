# Extend Society6 Crawler to Include Throw Pillows (and be extensible)

## What I need

Extend my existing scraper at `society6-clean-wall-art-crawler` so it also pulls **throw pillows** from Society6 — and ideally becomes easy to add more product types (mugs, wall murals, tapestries, etc.) in the future. The output CSV should include pillow rows alongside the existing wall art rows, using the same schema.

Start by reading the existing crawler code before proposing any changes. I don't know what language or framework it's in — your first job is to figure that out and then make a judgment call about whether the cleanest extension is (a) add a single URL to an existing collection list, (b) parameterize the scraper to accept a product-type argument, or (c) refactor more deeply so multiple product types are first-class. Pick the option that's proportional to the codebase — don't over-engineer a 200-line script.

## Context: why this matters

This crawler feeds a downstream curation app called **Society6 Curation Tool BETA** (Next.js, deployed on Netlify). The app reads the crawler's CSV output, stores it in Netlify Blobs, and uses it to power AI-assisted wall art recommendations for interior designers and hotel/restaurant clients.

I recently added a "Product Types" filter to that app that includes a **"Include throw pillows"** toggle. The toggle already works on the app side — there's code that recognizes `source_collection: "throw-pillows"` and lets those items flow through scoring and recommendations. But right now the catalog CSV has **zero** pillow rows, because the crawler only scrapes wall art. So the filter has nothing to match. That's the gap this task closes.

## The contract: what the downstream app expects

The app reads a CSV named `listing_records.csv` with these columns (this is the schema the crawler already produces — don't change it):

```
title,product_url,product_handle,source_collection,image_url,image_alt
```

- `title` — human-readable product name (e.g., "Blue Abstract Waves Throw Pillow")
- `product_url` — absolute or relative S6 product URL (both formats accepted downstream; relative like `/products/blue-abstract-waves-pillow` is fine)
- `product_handle` — the slug after `/products/` (e.g., `blue-abstract-waves-pillow`)
- `source_collection` — **this is the critical field for this task**. For pillows it must be the string `throw-pillows` (lowercase, hyphenated). For existing wall art it's whatever the crawler currently produces (`art-prints`, `canvas-prints`, `wood-wall-art`, etc.)
- `image_url` — product image, absolute or relative
- `image_alt` — alt text, used as a secondary signal by the app's tagger

The app's `productCategory()` function recognizes pillows via a regex on `source_collection` that matches `/throw.?pillow|\bpillow/`. As long as `source_collection` contains the word "pillow" in some form, it'll be categorized correctly.

## Starting point: Society6's throw pillow listing

The most likely entry point is: `https://society6.com/throw-pillows`

Society6 listing pages typically use:
- Pagination via a `page=N` query param or infinite scroll
- Product tile links matching `/product/<handle>` or `/products/<handle>`
- Open Graph / JSON-LD on product pages with the image URL and title

Confirm these assumptions by inspecting the actual page before hardcoding anything — S6 may have changed their markup since the original crawler was written.

## Constraints

1. **Don't break wall art.** The existing wall art scrape must continue to work and produce the same output it always did. If you introduce a product-type argument, default it to the existing behavior.
2. **Preserve the CSV schema exactly.** Same columns, same order, same encoding. The downstream app parses this with PapaParse and is sensitive to column names.
3. **Be polite.** Respect `robots.txt` if it's already being respected, keep whatever rate-limiting/delays already exist, use the same User-Agent. Society6 is a real company and we don't want to hammer them.
4. **Output location.** The app's catalog upload page looks for `society6-clean-wall-art-crawler/output/listing_records.csv` — keep writing to that path (or let the user concatenate a separate pillow CSV onto it; ask what's cleaner once you've seen the code).
5. **Idempotency.** If the crawler is re-run, it should overwrite cleanly, not append duplicates. Preserve whatever behavior already exists here.

## Definition of done

- Running the crawler produces a `listing_records.csv` that contains both wall art rows (unchanged) and throw pillow rows.
- Every throw pillow row has `source_collection` set to `throw-pillows` (or at least contains the word "pillow" somewhere).
- Every row has all six columns populated — no blank `product_url`, no blank `title`.
- A spot check of ~20 random pillow rows in the CSV, opened against the live S6 pages, confirms the titles and image URLs match.
- The wall art row count is within a reasonable delta of what it used to be (not accidentally halved or doubled).
- If you changed the crawler's invocation (added a CLI flag, changed env vars), document it in the crawler's README so the next person can reproduce.

## Stretch (only if the codebase is amenable — don't force it)

- Make the crawler take a configurable list of product types (wall-art, throw-pillows, and room for future ones) so adding "wall murals" next quarter is a one-line config change, not another refactor.
- Emit a small summary log at the end: "Scraped 12,345 wall art + 2,891 pillows = 15,236 total rows written to output/listing_records.csv."
- If the crawler currently fails silently on individual product page errors, preserve that behavior but log the count at the end so I can tell if coverage degraded.

## What to do first

1. Ask me to connect the `society6-clean-wall-art-crawler` folder so you can read it.
2. Read the existing crawler code end-to-end before proposing changes. Understand how it iterates collection URLs, how it extracts fields from a product page, where it writes output, and what rate-limiting is in place.
3. Come back with a 3-5 bullet plan: what you'll change, why, what you expect the runtime and output delta to look like. I'll approve before you edit.
4. Then make the change, run the crawler (or a dry-run subset if it takes a while), verify the output, and hand back with the diff and a sample of 10 pillow rows from the output CSV.

## Background files you should NOT need but may want as reference

The app-side filter logic lives in `/Users/johnalderman/Desktop/S6-Trade-Curation-Tool/S6 Trade Curation Tool/app/api/recommend/route.js` — specifically the `productCategory()` and `passesProductFilters()` functions. You won't touch that code, but if you want to double-check exactly how the app categorizes a `source_collection` string, that's the source of truth.
