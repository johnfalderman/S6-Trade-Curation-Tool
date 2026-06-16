#!/usr/bin/env node
/**
 * import-catalog.js
 * Truncates the products table and does a clean reimport from
 * ~/Downloads/listing_records.csv.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node scripts/import-catalog.js
 */

const { createReadStream } = require('fs');
const { parse } = require('csv-parse');
const { Pool } = require('pg');
const os = require('os');
const path = require('path');

const CSV_PATH = path.join(os.homedir(), 'Downloads', 'listing_records.csv');
const BATCH_SIZE = 500;

// Kept in sync with lib/ingest.js
const CATEGORY_MAP = [
  { pattern: /wall.?art|art.?print|canvas|framed|poster|tapestry|metal.?print/i, category: 'wall_art' },
  { pattern: /pillow|throw|blanket|duvet|shower.?curtain|mug|tray|clock|rug/i,   category: 'home_decor' },
  { pattern: /t-shirt|hoodie|sweatshirt|tank|leggings|dress|apparel/i,            category: 'apparel' },
  { pattern: /tote|bag|backpack|phone.?case|laptop.?sleeve|accessory/i,           category: 'accessories' },
  { pattern: /notebook|journal|greeting.?card|sticker|stationery/i,               category: 'stationery' },
  { pattern: /laptop|ipad|device|tech/i,                                           category: 'tech' },
];

function inferCategory(productType) {
  for (const { pattern, category } of CATEGORY_MAP) {
    if (pattern.test(productType)) return category;
  }
  return 'other';
}

function fixImageUrl(url) {
  return url ? url.replace(/width=3840/g, 'width=400') : null;
}

const INSERT_SQL = `
  INSERT INTO products (
    s6_product_id, s6_variant_id,
    title, artist_name, artist_handle,
    category, product_type,
    tags, price_usd,
    image_url, product_url,
    feed_source, feed_ingested_at, feed_updated_at,
    enrichment_status
  ) VALUES (
    $1, null,
    $2, null, null,
    $3, $4,
    null, null,
    $5, $6,
    'listing_csv', now(), now(),
    CASE WHEN $5::text IS NULL OR $5::text = ''
      THEN 'skipped'::enrichment_status
      ELSE 'pending'::enrichment_status
    END
  )
`;

async function flushBatch(client, batch) {
  await client.query('BEGIN');
  for (const params of batch) {
    await client.query(INSERT_SQL, params);
  }
  await client.query('COMMIT');
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL is not set.');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 5,
  });

  const client = await pool.connect();

  try {
    console.log('Truncating products table (CASCADE)...');
    await client.query('TRUNCATE products RESTART IDENTITY CASCADE');
    console.log(`Reading ${CSV_PATH}\n`);

    const parser = createReadStream(CSV_PATH).pipe(
      parse({ columns: true, skip_empty_lines: true, trim: true })
    );

    let total = 0;
    let skipped = 0;
    let batch = [];

    for await (const row of parser) {
      const handle = row.product_handle || row.handle;
      if (!handle) { skipped++; continue; }

      const productType = row.artwork_family || '';
      batch.push([
        handle,
        row.title || 'Untitled',
        inferCategory(productType),
        productType || null,
        fixImageUrl(row.image_url),
        row.product_url || null,
      ]);
      total++;

      if (batch.length >= BATCH_SIZE) {
        await flushBatch(client, batch);
        batch = [];
      }

      if (total % 1000 === 0) {
        process.stdout.write(`\r  Imported ${total.toLocaleString()} rows...`);
      }
    }

    if (batch.length > 0) {
      await flushBatch(client, batch);
    }

    console.log(`\r  Imported ${total.toLocaleString()} rows...`);
    console.log(`\nDone.`);
    console.log(`  Total imported: ${total.toLocaleString()}`);
    if (skipped > 0) {
      console.log(`  Skipped:        ${skipped.toLocaleString()} (no product_handle)`);
    }

  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('\nImport failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
