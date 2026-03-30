import { NextResponse } from 'next/server';
import { saveCatalog, getCatalogMeta } from '../../../lib/catalog';

// GET — return current catalog info
export async function GET() {
  try {
    const meta = await getCatalogMeta();
    return NextResponse.json({ success: true, ...meta });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST — accept catalog data and save it
// Supports three formats:
//   1. { compact: [{t,u,h,c,i,a}, ...] }  — client-side parsed (preferred, avoids 6MB limit)
//   2. { csv: "..." }                       — full CSV in JSON body (legacy)
//   3. raw text/plain or text/csv body      — full CSV text (legacy)
export async function POST(request) {
  try {
    const contentType = request.headers.get('content-type') || '';

    let records = [];

    if (contentType.includes('application/json')) {
      const body = await request.json();

      if (body.compact && Array.isArray(body.compact)) {
        // Compact format from client-side PapaParse
        records = body.compact
          .filter(r => r.u)
          .map(r => ({
            title: r.t || '',
            product_url: r.u || '',
            product_handle: r.h || '',
            source_collection: r.c || '',
            image_url: r.i || '',
            image_alt: r.a || '',
          }));
      } else if (body.csv) {
        // Legacy JSON wrapper
        const csvText = body.csv;
        const parsed = parseCSV(csvText);
        records = parsed.map(normalizeRecord).filter(r => r.product_url);
      } else {
        return NextResponse.json(
          { error: 'Expected { compact: [...] } or { csv: "..." }' },
          { status: 400 }
        );
      }
    } else if (contentType.includes('text/plain') || contentType.includes('text/csv')) {
      const csvText = await request.text();
      const parsed = parseCSV(csvText);
      records = parsed.map(normalizeRecord).filter(r => r.product_url);
    } else {
      return NextResponse.json(
        { error: 'Send compact JSON, CSV as text/plain, or JSON body with { csv: "..." }' },
        { status: 400 }
      );
    }

    if (records.length === 0) {
      return NextResponse.json({ error: 'No valid records found in uploaded data.' }, { status: 400 });
    }

    saveCatalog(records);

    return NextResponse.json({
      success: true,
      count: records.length,
      sampleTitles: records.slice(0, 3).map(r => r.title),
    });
  } catch (err) {
    console.error('[/api/catalog POST]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/);
  if (lines.length < 2) return [];

  const headers = parseLine(lines[0]);
  const records = [];

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cols = parseLine(lines[i]);
    const record = {};
    headers.forEach((h, idx) => {
      record[h] = cols[idx] ?? '';
    });
    records.push(record);
  }

  return records;
}

function parseLine(line) {
  const cols = [];
  let current = '';
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      cols.push(current.replace(/^"|"$/g, '').trim());
      current = '';
    } else {
      current += ch;
    }
  }
  cols.push(current.replace(/^"|"$/g, '').trim());
  return cols;
}

const FIELD_MAP = {
  source_collection: ['source_collection', 'collection', 'source'],
  product_url: ['product_url', 'url', 'href', 'link'],
  product_handle: ['product_handle', 'handle', 'slug'],
  title: ['title', 'name', 'product_title'],
  image_url: ['image_url', 'img_url', 'image', 'img'],
  image_alt: ['image_alt', 'alt', 'alt_text'],
};

function normalizeRecord(raw) {
  const out = {};
  for (const [canonical, aliases] of Object.entries(FIELD_MAP)) {
    const key = aliases.find(a => raw[a] !== undefined);
    out[canonical] = key ? raw[key] : '';
  }
  return out;
}
