/**
 * S6 Catalog Enrichment Service — Feed Ingestion Module
 * ======================================================
 * Accepts a Society6 product feed (Shopify CSV export or
 * Shopify Admin API response) and upserts it into the
 * enrichment database.
 *
 * Usage:
 *   import { ingestFromCSV, ingestFromShopifyAPI } from './ingest.js'
 *
 *   // From a CSV file path (server-side / CLI)
 *   await ingestFromCSV('./listing_records.csv', { category: 'wall_art' })
 *
 *   // From a Shopify API response (webhook or scheduled pull)
 *   await ingestFromShopifyAPI(products, { category: 'home_decor' })
 *
 * Dependencies:
 *   npm install pg csv-parse
 *
 * Environment variables required:
 *   DATABASE_URL  — Postgres connection string (Neon / Supabase / etc.)
 */

import fs from 'fs';
import { createReadStream } from 'fs';
import { parse } from 'csv-parse';
import pg from 'pg';

const { Pool } = pg;


// ── DB connection ─────────────────────────────────────────────

let _pool = null;

function getPool() {
  if (!_pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL environment variable is not set.');
    }
    _pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }, // required for Neon / Supabase
      max: 10,
    });
  }
  return _pool;
}


// ── Category inference ────────────────────────────────────────
// Maps product type strings from the feed to our category enum.
// Extend this as we ingest more categories.

const CATEGORY_MAP = [
  { pattern: /wall art|art print|canvas|framed|poster|tapestry|metal print/i, category: 'wall_art' },
  { pattern: /pillow|throw|blanket|duvet|shower curtain|mug|tray|clock|rug/i, category: 'home_decor' },
  { pattern: /t-shirt|hoodie|sweatshirt|tank|leggings|dress|apparel/i, category: 'apparel' },
  { pattern: /tote|bag|backpack|phone case|laptop sleeve|accessory/i, category: 'accessories' },
  { pattern: /notebook|journal|greeting card|sticker|stationery/i, category: 'stationery' },
  { pattern: /laptop|ipad|device|tech/i, category: 'tech' },
];

function inferCategory(productType = '', tags = []) {
  const haystack = `${productType} ${tags.join(' ')}`;
  for (const { pattern, category } of CATEGORY_MAP) {
    if (pattern.test(haystack)) return category;
  }
  return 'other';
}


// ── Shopify CSV normalizer ────────────────────────────────────
// Shopify's product CSV export schema. Column names may vary
// slightly by store configuration — adjust field names here
// if the S6 export differs.
//
// Expected columns (case-insensitive, trimmed):
//   Handle, Title, Vendor, Type, Tags, Variant Price,
//   Image Src, [custom: Artist Name, Artist Handle, Product URL]

function normalizeShopifyCSVRow(row) {
  // Normalize column names: lowercase + trim
  const r = {};
  for (const [k, v] of Object.entries(row)) {
    r[k.toLowerCase().trim()] = typeof v === 'string' ? v.trim() : v;
  }

  const productId = r['handle'] || r['id'] || r['variant id'];
  if (!productId) return null; // skip rows with no identifier

  const productType = r['type'] || r['product type'] || '';
  const tags = (r['tags'] || '').split(',').map(t => t.trim()).filter(Boolean);

  return {
    s6_product_id:  productId,
    s6_variant_id:  r['variant id'] || null,
    title:          r['title'] || 'Untitled',
    artist_name:    r['artist name'] || r['vendor'] || null,
    artist_handle:  r['artist handle'] || null,
    product_type:   productType || null,
    category:       inferCategory(productType, tags),
    tags:           tags.length > 0 ? tags : null,
    price_usd:      parseFloat(r['variant price'] || r['price']) || null,
    image_url:      r['image src'] || r['image_url'] || null,
    product_url:    r['product url'] || r['url'] || null,
    feed_source:    'shopify_csv',
  };
}


// ── Shopify Admin API normalizer ──────────────────────────────
// Normalizes a product object from the Shopify Admin REST or
// GraphQL API into our internal schema.

function normalizeShopifyAPIProduct(product) {
  if (!product?.id) return null;

  const productType = product.product_type || '';
  const tags = typeof product.tags === 'string'
    ? product.tags.split(',').map(t => t.trim()).filter(Boolean)
    : (Array.isArray(product.tags) ? product.tags : []);

  const firstVariant = product.variants?.[0];
  const firstImage = product.images?.[0];

  return {
    s6_product_id:  String(product.id),
    s6_variant_id:  firstVariant ? String(firstVariant.id) : null,
    title:          product.title || 'Untitled',
    artist_name:    product.vendor || null,
    artist_handle:  null, // not in standard Shopify API; add metafield pull if available
    product_type:   productType || null,
    category:       inferCategory(productType, tags),
    tags:           tags.length > 0 ? tags : null,
    price_usd:      parseFloat(firstVariant?.price) || null,
    image_url:      firstImage?.src || null,
    product_url:    product.handle
                      ? `https://society6.com/product/${product.handle}`
                      : null,
    feed_source:    'shopify_api',
  };
}


// ── Upsert logic ──────────────────────────────────────────────
// Upserts a batch of normalized product rows.
//
// Key decisions:
// - If the product is new → insert with status 'pending'
// - If the product exists and image_url has changed → update and
//   reset enrichment_status to 'pending' so it gets re-enriched
// - If the product exists and image_url is unchanged → update
//   catalog fields only, leave enrichment_status alone
// - If image_url is null/empty → set status to 'skipped'

const UPSERT_SQL = `
INSERT INTO products (
  s6_product_id,
  s6_variant_id,
  title,
  artist_name,
  artist_handle,
  category,
  product_type,
  tags,
  price_usd,
  image_url,
  product_url,
  feed_source,
  feed_ingested_at,
  feed_updated_at,
  enrichment_status
)
VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
  now(), now(),
  CASE WHEN $10 IS NULL OR $10 = '' THEN 'skipped'::enrichment_status
       ELSE 'pending'::enrichment_status
  END
)
ON CONFLICT (s6_product_id) DO UPDATE SET
  s6_variant_id       = EXCLUDED.s6_variant_id,
  title               = EXCLUDED.title,
  artist_name         = EXCLUDED.artist_name,
  artist_handle       = EXCLUDED.artist_handle,
  category            = EXCLUDED.category,
  product_type        = EXCLUDED.product_type,
  tags                = EXCLUDED.tags,
  price_usd           = EXCLUDED.price_usd,
  image_url           = EXCLUDED.image_url,
  product_url         = EXCLUDED.product_url,
  feed_source         = EXCLUDED.feed_source,
  feed_updated_at     = now(),
  -- Reset to pending if the image changed (needs re-enrichment)
  -- or if it was previously skipped but now has an image
  enrichment_status   = CASE
    WHEN EXCLUDED.image_url IS NULL OR EXCLUDED.image_url = ''
      THEN 'skipped'::enrichment_status
    WHEN products.image_url IS DISTINCT FROM EXCLUDED.image_url
      THEN 'pending'::enrichment_status
    WHEN products.enrichment_status = 'skipped'
      AND EXCLUDED.image_url IS NOT NULL
      AND EXCLUDED.image_url != ''
      THEN 'pending'::enrichment_status
    ELSE products.enrichment_status
  END,
  updated_at          = now()
`;

async function upsertBatch(client, rows) {
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    if (!row) { skipped++; continue; }
    try {
      await client.query(UPSERT_SQL, [
        row.s6_product_id,
        row.s6_variant_id,
        row.title,
        row.artist_name,
        row.artist_handle,
        row.category,
        row.product_type,
        row.tags,
        row.price_usd,
        row.image_url,
        row.product_url,
        row.feed_source,
      ]);
      inserted++; // ON CONFLICT means this covers both insert + update
    } catch (err) {
      console.error(`  ✗ Failed to upsert ${row.s6_product_id}: ${err.message}`);
      skipped++;
    }
  }

  return { inserted, updated, skipped };
}


// ── Progress logger ───────────────────────────────────────────

function logProgress(processed, total, label = '') {
  const pct = total > 0 ? Math.round((processed / total) * 100) : '?';
  process.stdout.write(`\r  ${label}${processed.toLocaleString()} / ${total > 0 ? total.toLocaleString() : '?'} (${pct}%)`);
}


// ── Public: ingest from CSV file ──────────────────────────────

/**
 * Ingest a Shopify CSV export file into the enrichment database.
 *
 * @param {string} filePath - Absolute or relative path to the CSV file
 * @param {object} options
 * @param {string} [options.category] - Override category inference for all rows
 * @param {number} [options.batchSize=500] - Rows per DB transaction
 * @returns {Promise<IngestResult>}
 */
export async function ingestFromCSV(filePath, options = {}) {
  const { batchSize = 500 } = options;

  if (!fs.existsSync(filePath)) {
    throw new Error(`CSV file not found: ${filePath}`);
  }

  console.log(`\n📥 Ingesting CSV: ${filePath}`);

  // Count lines for progress reporting (optional, skips if file is huge)
  let totalRows = 0;
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    totalRows = content.split('\n').length - 2; // subtract header + trailing newline
  } catch (_) { /* non-fatal */ }

  const pool = getPool();
  const client = await pool.connect();

  const stats = { total: 0, inserted: 0, skipped: 0, errors: 0 };
  let batch = [];

  try {
    const parser = createReadStream(filePath).pipe(
      parse({ columns: true, skip_empty_lines: true, trim: true })
    );

    for await (const row of parser) {
      const normalized = normalizeShopifyCSVRow(row);

      // Override category if explicitly provided
      if (options.category && normalized) {
        normalized.category = options.category;
      }

      batch.push(normalized);
      stats.total++;

      if (batch.length >= batchSize) {
        await client.query('BEGIN');
        const result = await upsertBatch(client, batch);
        await client.query('COMMIT');
        stats.inserted += result.inserted;
        stats.skipped  += result.skipped;
        batch = [];
        logProgress(stats.total, totalRows, 'Processed: ');
      }
    }

    // Flush remaining rows
    if (batch.length > 0) {
      await client.query('BEGIN');
      const result = await upsertBatch(client, batch);
      await client.query('COMMIT');
      stats.inserted += result.inserted;
      stats.skipped  += result.skipped;
    }

  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  console.log(`\n✅ CSV ingestion complete.`);
  console.log(`   Total rows:  ${stats.total.toLocaleString()}`);
  console.log(`   Upserted:    ${stats.inserted.toLocaleString()}`);
  console.log(`   Skipped:     ${stats.skipped.toLocaleString()}`);

  return stats;
}


// ── Public: ingest from Shopify API response ──────────────────

/**
 * Ingest an array of Shopify product objects (from Admin REST or
 * GraphQL API) into the enrichment database.
 *
 * @param {object[]} products - Array of Shopify product objects
 * @param {object} options
 * @param {string} [options.category] - Override category inference for all rows
 * @param {number} [options.batchSize=500] - Rows per DB transaction
 * @returns {Promise<IngestResult>}
 */
export async function ingestFromShopifyAPI(products, options = {}) {
  const { batchSize = 500 } = options;

  console.log(`\n📥 Ingesting ${products.length.toLocaleString()} products from Shopify API`);

  const pool = getPool();
  const client = await pool.connect();

  const stats = { total: 0, inserted: 0, skipped: 0, errors: 0 };
  let batch = [];

  try {
    for (const product of products) {
      const normalized = normalizeShopifyAPIProduct(product);

      if (options.category && normalized) {
        normalized.category = options.category;
      }

      batch.push(normalized);
      stats.total++;

      if (batch.length >= batchSize) {
        await client.query('BEGIN');
        const result = await upsertBatch(client, batch);
        await client.query('COMMIT');
        stats.inserted += result.inserted;
        stats.skipped  += result.skipped;
        batch = [];
        logProgress(stats.total, products.length, 'Processed: ');
      }
    }

    if (batch.length > 0) {
      await client.query('BEGIN');
      const result = await upsertBatch(client, batch);
      await client.query('COMMIT');
      stats.inserted += result.inserted;
      stats.skipped  += result.skipped;
    }

  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  console.log(`\n✅ API ingestion complete.`);
  console.log(`   Total rows:  ${stats.total.toLocaleString()}`);
  console.log(`   Upserted:    ${stats.inserted.toLocaleString()}`);
  console.log(`   Skipped:     ${stats.skipped.toLocaleString()}`);

  return stats;
}


// ── Public: get enrichment queue stats ───────────────────────

/**
 * Returns a summary of enrichment status across the catalog.
 * Useful for the dashboard and for deciding what to run next.
 */
export async function getEnrichmentStats() {
  const pool = getPool();
  const { rows } = await pool.query(`SELECT * FROM enrichment_summary ORDER BY category`);
  return rows;
}


// ── CLI entry point ───────────────────────────────────────────
// Run directly with: node ingest.js ./listing_records.csv wall_art

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const [,, filePath, category] = process.argv;

  if (!filePath) {
    console.error('Usage: node ingest.js <path-to-csv> [category]');
    console.error('  category: wall_art | home_decor | apparel | accessories | stationery | tech | other');
    process.exit(1);
  }

  ingestFromCSV(filePath, { category: category || undefined })
    .then(stats => {
      console.log('\nDone.', stats);
      process.exit(0);
    })
    .catch(err => {
      console.error('\nIngestion failed:', err.message);
      process.exit(1);
    });
}