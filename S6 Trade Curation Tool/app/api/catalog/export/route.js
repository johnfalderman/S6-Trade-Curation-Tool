import { NextResponse } from 'next/server';
import pg from 'pg';

export const dynamic = 'force-dynamic';

const { Pool } = pg;
const ARRAY_SEP = '|';
const COLUMNS = [
  'title',
  'product_url',
  'product_handle',
  'source_collection',
  'image_url',
  'image_alt',
  'visionSummary',
  'visionSubject',
  'visionStyle',
  'visionPalette',
  'visionMood',
  'visionKeywords',
  'visionAt',
  'visionError',
];

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

async function viewExists(pool, name) {
  const { rows } = await pool.query(
    `SELECT 1 FROM information_schema.views
     WHERE table_schema = 'public' AND table_name = $1`,
    [name]
  );
  return rows.length > 0;
}

// Shared SELECT that works whether we're querying the view or the raw tables.
// Returns rows with camelCase keys matching COLUMNS.
async function fetchRecords(onlyEnriched) {
  const pool = getPool();
  const useView = await viewExists(pool, 'enriched_products');

  let sql;
  if (useView) {
    sql = `
      SELECT
        title,
        product_url,
        s6_product_id       AS product_handle,
        ''                  AS source_collection,
        image_url,
        ''                  AS image_alt,
        vision_summary      AS "visionSummary",
        vision_subject      AS "visionSubject",
        vision_style        AS "visionStyle",
        vision_palette      AS "visionPalette",
        vision_mood         AS "visionMood",
        vision_keywords     AS "visionKeywords",
        vision_at           AS "visionAt",
        vision_error        AS "visionError"
      FROM enriched_products
      ${onlyEnriched ? "WHERE vision_summary IS NOT NULL AND vision_summary != ''" : ''}
      ORDER BY id
    `;
  } else {
    const join = onlyEnriched ? 'INNER' : 'LEFT';
    sql = `
      SELECT
        p.title,
        p.product_url,
        p.s6_product_id       AS product_handle,
        ''                    AS source_collection,
        p.image_url,
        ''                    AS image_alt,
        r.vision_summary      AS "visionSummary",
        r.vision_subject      AS "visionSubject",
        r.vision_style        AS "visionStyle",
        r.vision_palette      AS "visionPalette",
        r.vision_mood         AS "visionMood",
        r.vision_keywords     AS "visionKeywords",
        r.created_at          AS "visionAt",
        p.enrichment_error    AS "visionError"
      FROM products p
      ${join} JOIN enrichment_results r
        ON r.product_id = p.id AND r.is_current = true
      ORDER BY p.id
    `;
  }

  const { rows } = await pool.query(sql);

  // Normalize: convert Date objects to ISO strings, coerce nulls on array fields.
  return rows.map(r => ({
    ...r,
    visionAt: r.visionAt instanceof Date ? r.visionAt.toISOString() : (r.visionAt || ''),
  }));
}

// ——— GET: download enriched catalog ———————————————————————————————————————
// Query params:
//   ?format=csv (default) — listing_records.csv-shape with vision columns
//                            appended. Pipe-delimited inside array cells.
//   ?format=json          — raw records array, vision fields as arrays.
//   ?onlyEnriched=true    — restrict to records that have vision data.
export async function GET(request) {
  try {
    const url = new URL(request.url);
    const format = (url.searchParams.get('format') || 'csv').toLowerCase();
    const onlyEnriched = url.searchParams.get('onlyEnriched') === 'true';

    const records = await fetchRecords(onlyEnriched);

    const dateStamp = new Date().toISOString().slice(0, 10);
    const filenameBase = onlyEnriched
      ? `s6-catalog-enriched-${dateStamp}`
      : `s6-catalog-full-${dateStamp}`;

    if (format === 'json') {
      return new NextResponse(JSON.stringify(records, null, 2), {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filenameBase}.json"`,
          'Cache-Control': 'no-store',
        },
      });
    }

    // CSV — default. UTF-8 BOM so Excel opens it cleanly.
    const csv = recordsToCsv(records);
    return new NextResponse('﻿' + csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filenameBase}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('Export error:', err);
    return NextResponse.json({ error: err.message || 'Export failed' }, { status: 500 });
  }
}

function recordsToCsv(records) {
  const lines = [COLUMNS.join(',')];
  for (const r of records) {
    const row = COLUMNS.map(col => {
      const v = r[col];
      if (v === undefined || v === null) return '';
      if (Array.isArray(v)) return csvEscape(v.join(ARRAY_SEP));
      return csvEscape(String(v));
    });
    lines.push(row.join(','));
  }
  return lines.join('\n');
}

function csvEscape(s) {
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
