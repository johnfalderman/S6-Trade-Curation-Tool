import { NextResponse } from 'next/server';
import { getStore } from '@netlify/blobs';
import { gunzipSync } from 'zlib';
import pg from 'pg';
import { parse as parseCsv } from 'csv-parse/sync';

const BLOB_STORE = 'catalog';
const { Pool } = pg;

// ── Postgres ──────────────────────────────────────────────────────────────────

let _pool = null;
function getPool() {
  if (!_pool) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set.');
    _pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 5,
    });
  }
  return _pool;
}

// Kept in sync with scripts/import-catalog.js
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

function toAbsoluteUrl(url) {
  if (!url) return null;
  return url.startsWith('/') ? 'https://society6.com' + url : url;
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

async function truncateAndInsert(rows) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('TRUNCATE products RESTART IDENTITY CASCADE');
    const BATCH_SIZE = 500;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      await client.query('BEGIN');
      for (const params of batch) {
        await client.query(INSERT_SQL, params);
      }
      await client.query('COMMIT');
    }
    return rows.length;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ── GET: catalog status ───────────────────────────────────────────────────────

export async function GET() {
  try {
    const store = getStore(BLOB_STORE);
    const meta = await store.get('meta', { type: 'json' }).catch(() => null);
    if (meta) {
      const enrichMeta = await store.get('enrichment-meta', { type: 'json' }).catch(() => null);
      return NextResponse.json({
        ...meta,
        enrichment: enrichMeta || {
          enrichedCount: 0,
          totalRecords: meta.count || 0,
          status: 'idle',
        },
      });
    }
  } catch (e) {
    // fall through to lib/catalog
  }
  try {
    const { getCatalogMeta } = await import('../../../lib/catalog');
    const meta = await getCatalogMeta();
    return NextResponse.json(meta);
  } catch (e) {
    return NextResponse.json({ source: 'sample', count: 51 });
  }
}

// ── POST: import catalog into Postgres ────────────────────────────────────────
//
// Accepts two formats:
//
//   1. multipart/form-data with a `file` field containing a listing_records.csv.
//      Parsed server-side; columns: product_handle, title, artwork_family,
//      image_url, product_url. This is the preferred direct-upload path.
//
//   2. application/json with { gzip: "<base64>" } or { compact: [...] }.
//      Legacy format sent by the browser upload UI (CSV parsed + compressed
//      client-side). Accepted for backwards compatibility.
//
// Both paths TRUNCATE products RESTART IDENTITY CASCADE then batch-insert.

export async function POST(request) {
  try {
    const contentType = request.headers.get('content-type') || '';
    let rows = [];

    // ── Path 1: CSV file upload ───────────────────────────────────────────────
    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const file = formData.get('file') || formData.get('csv');
      if (!file || typeof file.text !== 'function') {
        return NextResponse.json(
          { error: 'No CSV file in request — expected a field named "file"' },
          { status: 400 }
        );
      }

      const text = await file.text();
      const records = parseCsv(text, { columns: true, skip_empty_lines: true, trim: true });

      rows = records
        .filter(r => r.product_handle || r.handle)
        .map(r => {
          const handle = r.product_handle || r.handle;
          const productType = r.artwork_family || '';
          return [
            handle,
            r.title || 'Untitled',
            inferCategory(productType),
            productType || null,
            fixImageUrl(r.image_url) || null,
            r.product_url || null,
          ];
        });

      if (!rows.length) {
        return NextResponse.json(
          { error: 'No valid records found in CSV (is product_handle column present?)' },
          { status: 400 }
        );
      }

    // ── Path 2: compact/gzip JSON (browser upload UI) ─────────────────────────
    } else {
      const body = await request.json();
      let compact = [];

      if (body.gzip) {
        const compressed = Buffer.from(body.gzip, 'base64');
        const json = gunzipSync(compressed).toString('utf-8');
        const parsed = JSON.parse(json);
        compact = parsed.compact || [];
      } else if (Array.isArray(body.compact)) {
        compact = body.compact;
      } else {
        return NextResponse.json(
          { error: 'Expected multipart CSV upload, { gzip: "..." }, or { compact: [...] }' },
          { status: 400 }
        );
      }

      // Compact format: { t: title, u: product_url (relative), h: handle,
      //                   c: source_collection, i: image_url, a: image_alt }
      rows = compact
        .filter(r => r.u || r.h)
        .map(r => {
          const handle = r.h || r.u;
          const productType = r.c || '';
          const imageUrl = fixImageUrl(r.i) || null;
          const productUrl = toAbsoluteUrl(r.u) || null;
          return [
            handle,
            r.t || 'Untitled',
            inferCategory(productType),
            productType || null,
            imageUrl,
            productUrl,
          ];
        });

      if (!rows.length) {
        return NextResponse.json({ error: 'No valid records found' }, { status: 400 });
      }
    }

    const count = await truncateAndInsert(rows);
    return NextResponse.json({ success: true, count });

  } catch (err) {
    console.error('Catalog POST error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
