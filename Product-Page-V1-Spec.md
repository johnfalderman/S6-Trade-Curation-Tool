# Society6 Vision-Enriched Product Page — V1 Spec

## Context and goal

This spec defines a first-pass implementation of a vision-enriched product detail page (PDP) for Society6, built on a Shopify sandbox for the purposes of a working prototype the team can react to. Every product in the sandbox has already been hydrated with the following vision metadata as Shopify metafields (referenced in this doc as `vision.style`, `vision.mood`, `vision.palette`, `vision.subject`, `vision.keywords`, `vision.summary` — adjust namespace as needed to match your actual Shopify metafield setup):

- **vision.style** — an array of art style descriptors (e.g. `line-art`, `mid-century`, `photography`)
- **vision.mood** — an array of emotional tone descriptors (e.g. `playful`, `moody`, `serene`)
- **vision.palette** — an array of dominant color descriptors (e.g. `cobalt`, `terracotta`, `monochrome`)
- **vision.subject** — an array of high-level subject categories (e.g. `food-drink`, `coastal`, `floral`)
- **vision.keywords** — an array of 10-20 concrete descriptive keywords pulled from the artwork itself
- **vision.summary** — a single sentence describing the artwork's visual content

The goal of V1 is to demonstrate, in a working Shopify environment, how this metadata can be deployed across visible UX and background SEO/AEO surfaces in a way that meaningfully improves shopper discovery, search visibility, and AI-search legibility — without trampling the artist's voice or overwhelming the visual design of the page.

---

## Visible page structure

The prototype should preserve all existing Society6 product page elements (hero image carousel, format/size selector, price, add-to-cart, reviews, "you may also like" recommendations) and add or modify the following.

### About This Piece section (modified)

Restructure the existing "About This Piece" section into a two-part block with clear visual separation:

A **"From the artist"** block at the top, displaying the artist-supplied description in italics with explicit attribution to the artist. If the artist description is fewer than 30 words or missing, suppress the "From the artist" label entirely rather than displaying an awkwardly short or empty block.

A **"Visual description"** block immediately below, displaying the contents of `vision.summary` as the descriptive sentence about the artwork. This text should be labeled clearly so shoppers (and search engines) understand it as a supplemental visual description rather than artist-written. The labeling matters: hiding the AI origin erodes trust; labeling it builds trust.

When the artist description is empty entirely, the "Visual description" block becomes the primary content and the "From the artist" block is suppressed.

### Aesthetic block (new)

Add a new visible block, positioned below the "About This Piece" section, displaying selected vision metadata as visible chips. This block is the single most important new element on the page — it gives shoppers a vocabulary for taste-driven browsing and creates discovery paths between products.

The block should contain four rows:

**Style:** display the first 2-3 entries from `vision.style`, rendered as text chips. Example: *Pop-art · Illustration · Graphic*.

**Mood:** display 1-2 entries from `vision.mood`. Example: *Playful, Bold*. Resist the urge to display all mood tags — more than 2 visible mood chips makes the page feel auto-tagged.

**Palette:** display 3-5 colors from `vision.palette` as actual color swatches (small filled circles or squares) followed by their names. Example: 🟫⚫🟤 *Tan, black, brown*. The visual swatch is the most useful element for shoppers matching artwork to existing décor.

**Subject:** display 1-2 entries from `vision.subject` when they add meaningful context. Skip this row when the subject is redundant with the artwork title or obvious from the image (e.g. don't display "Subject: Florals" on a clearly floral painting). Translate raw tag labels into display-ready form: `food-drink` → "Food & Drink," `monochrome` → "Black & White."

Every chip in this block should be clickable, routing to a filtered category page using URL parameters (see Interactive Behavior section below).

### Existing elements (unchanged)

Hero image carousel, format/size selector, price, add-to-cart button, shipping info, reviews, related products, and footer remain unchanged for V1.

---

## Background metadata (not visible on page, but in source)

The same vision data should populate the following non-visible surfaces:

### JSON-LD structured data

Inject a `schema.org/Product` block into the page's HTML head. Required properties: `name`, `image`, `description`, `brand`, `offers`, `sku`. Augmented with vision data:

- `description` — combine artist description (if present) with `vision.summary` for the most descriptive possible product summary
- `keywords` — comma-separated values from `vision.keywords`
- `color` — comma-separated values from `vision.palette`
- `additionalProperty` array containing PropertyValue objects for Style (`vision.style`), Mood (`vision.mood`), and Subject (`vision.subject`)

This block is the single highest-leverage AI-search-engine optimization. ChatGPT's web search, Perplexity, Google AI Overviews, and Claude's web tools all weight schema.org markup heavily when answering product questions.

### HTML head tags

**`<title>` tag:** augment the existing format with vision data. Pattern: `[Artist Title] — [Style + Mood descriptor] [Subject Keyword] | [Product Format] | Society6`. Example: "These Boots Leopard Print — Bold Pop-Art Western Boot Illustration | Framed Art Print | Society6."

**`<meta name="description">`:** replace any generic auto-generated description with a sentence combining `vision.summary` and key product format/size info. Cap at ~155 characters for SERP display.

**Open Graph tags** (`og:description`, `og:image`, `og:title`) and **Twitter Card tags** should mirror the meta description and title content. These power how products appear when shared to Pinterest, Facebook, iMessage, Slack, etc.

### Image alt text

Replace existing alt attributes on hero product images with `vision.summary`. The current alt text is typically the product title repeated, which is useless for accessibility and Google Image Search. The vision summary gives screen readers a real description and gives Google Image search a real indexable description.

---

## Interactive behavior

### Clickable tag chips

Every chip in the Aesthetic block routes to a filtered category page using URL query parameters. Pattern:

```
/collections/wall-art?style=pop-art
/collections/wall-art?mood=moody&palette=monochrome
/collections/wall-art?subject=food-drink
```

The filtered category pages themselves are **out of scope for V1** — the routing is what matters for the prototype. A 404 or placeholder destination is acceptable; the point is to demonstrate that the chips are clickable and that the URL pattern is structured for eventual filtering.

### Color swatch hover

On hover, each color swatch should reveal the color name in a tooltip (accessible via `aria-label` for screen readers).

---

## Quality and edge-case rules

### Label translation table

Raw tag values from the metadata should be translated to display-ready labels before rendering. The translation should happen at the template level, not require re-tagging the data:

- `food-drink` → "Food & Drink"
- `monochrome` → "Black & White" (as a palette) or "Monochrome" (as a subject) depending on context
- `bw` → "Black & White"
- Multi-word tags should be displayed in title case: `mid-century` → "Mid-century," `line-art` → "Line Art"

### Max display counts per row

Strict caps on visible chip counts: 3 style chips max, 2 mood chips max, 5 palette swatches max, 2 subject chips max. The vision data may contain more — show only the first N. Restraint here protects the visual brand more than max coverage does.

### Fallback for sparse artist content

When the artist description is empty or under 30 words, suppress the "From the artist" label and lead with the "Visual description" block. Do not display empty placeholders or "no description available" text.

### Suppression mechanism (stub, not built in V1)

The page template should include a structural placeholder for a future artist/admin override mechanism (e.g. a metafield like `vision.suppress` that, if set to `true`, hides specific tags from display). This is a structural placeholder only for V1 — the actual override UI is not part of this build. The point is to make sure the template architecture can accommodate it later without rework.

---

## Shopify implementation notes

The prototype should be implemented in a single Shopify theme section (likely a modified `main-product.liquid` or a new section file like `vision-aesthetic-block.liquid`). The JSON-LD injection should go in `theme.liquid` or via the `content_for_header` hook to ensure it appears in the document head.

Metafield access follows Shopify's standard pattern: `{{ product.metafields.vision.style.value }}` (or whatever namespace was used during metadata import). Array metafields can be iterated with `{% for tag in product.metafields.vision.style.value %}`.

For the prototype to demonstrate value clearly, pick 3-5 products that have complete vision metadata and use them for the live demo. Mix product types (line art piece, photograph, abstract piece, floral) to show how the same template handles different aesthetic categories.

---

## What is explicitly out of scope for V1

The following are deliberately deferred and should not be built into this prototype:

The filtered category pages that the tag chips route to. Routing structure is in scope; destination pages are not.

The artist/admin override UI for suppressing wrong tags. Structural metafield placeholder is in scope; the actual UI is not.

Confidence scoring or tag-quality filtering. Assume all vision metadata is good enough for display in V1.

Internationalization or multi-language tag translation.

A/B testing instrumentation. The prototype should be visually inspectable and shareable internally; quantitative measurement is a later phase.

Recommendation algorithm changes. The "You may also like" section uses Shopify's existing logic for V1.

---

## Definition of done for V1

The prototype is shippable when:

1. A demo product page renders with the modified "About This Piece" section showing artist description + vision summary correctly attributed.
2. The Aesthetic block displays style, mood, palette, and subject chips with proper label translation and chip count limits.
3. Each chip is clickable and routes to a URL with the correct filter query parameters.
4. The page source contains a populated JSON-LD Product schema block with vision data injected into description, keywords, color, and additionalProperty fields.
5. The page `<title>`, meta description, OG tags, and image alt text all incorporate vision summary content.
6. The page renders correctly across desktop and mobile viewports with no layout regressions to existing elements.
7. The same template handles 3-5 demo products with different aesthetic profiles without manual per-product customization.

When all seven are true, the prototype is ready to demo to the team and to inform the production-side conversation with the Society6 engineering and product organizations.
