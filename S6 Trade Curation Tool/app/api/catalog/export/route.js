import { NextResponse } from 'next/server';
import { getStore } from '@netlify/blobs';

const BLOB_STORE = 'catalog';
const RECORDS_KEY = 'records';

// Columns emitted in the CSV export. Original Society6 fields come first
// (matching the input listing_records.csv shape so Society6 tooling can
// ingest this directly), followed by the vision-derived fields. Array
// fields are joined with '|' inside a cell — easy to split on the receiving
// end without colliding with commas in artwork titles.
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

// ——— GET: download enriched catalog ———————————————————————————————————————
// Query params:
//   ?format=csv (default) — listing_records.csv-shape with vision columns
//                            appended. Pipe-delimited inside array cells.
//   ?format=json          — raw records array, one record per element,
//                            vision fields preserved as arrays.
//   ?onlyEnriched=true    — restrict output to records that have vision
//                            data (skip un-enriched rows entirely).
export async function GET(request) {
  try {
    const url = new URL(request.url);
    const format = (url.searchParams.get('format') || 'csv').toLowerCase();
    const onlyEnriched = url.searchParams.get('onlyEnriched') === 'true';

    const store = getStore(BLOB_STORE);
    const raw = await store.get(RECORDS_KEY, { type: 'text' });
    if (!raw) {
      return NextResponse.json({ error: 'No catalog loaded.' }, { status: 400 });
    }

    let records = JSON.parse(raw);
    if (!Array.isArray(records)) {
      return NextResponse.json({ error: 'Catalog data corrupted.' }, { status: 500 });
    }

    if (onlyEnriched) {
      records = records.filter(r => Array.isArray(r.visionStyle) && r.visionStyle.length > 0);
    }

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

    // CSV path — default. UTF-8 BOM up front so Excel opens it cleanly.
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
    return NextResponse.json(
      { error: err.message || 'Export failed' },
      { status: 500 }
    );
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
  // Standard CSV escaping: wrap in quotes when content contains commas,
  // quotes, or newlines; double-up any embedded quotes.
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
