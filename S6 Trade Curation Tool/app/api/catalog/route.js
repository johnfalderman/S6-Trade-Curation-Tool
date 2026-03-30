import { NextResponse } from 'next/server';
import { saveCatalog, getCatalogMeta } from '../../../lib/catalog';

// GET — return current catalog info
export async function GET() {
  try {
    const meta = getCatalogMeta();
    return NextResponse.json({ success: true, ...meta });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST — accept a CSV text body and parse it into catalog.json
export async function POST(request) {
  try {
    const contentType = request.headers.get('content-type') || '';

    let csvText;

    if (contentType.includes('text/plain') || contentType.includes('text/csv')) {
      csvText = await request.text();
    } else if (contentType.includes('application/json')) {
      const body = await request.json();
      csvText = body.csv;
    } else {
      return NextResponse.json(
        { error: 'Send CSV as text/plain or JSON body with { csv: "..." }' },
        { status: 400 }
      );
    }

    if (!csvText || csvText.trim().length < 10) {
      return NextResponse.json({ error: 'Empty CSV received.' }, { status: 400 });
    }

    // Parse CSV
    const records = parseCSV(csvText);

    if (records.length === 0) {
      return NextResponse.json({ error: 'No records found in CSV.' }, { status: 400 });
    }

    // Normalize field names
    const normalized = records
      .map(normalizeRecord)
      .filter(r => r.product_url && r.title);

    if (normalized.length === 0) {
      return NextResponse.json(
        { error: 'Could not find required fields (title, product_url) in CSV.' },
        { status: 400 }
      );
    }

    saveCatalog(normalized);

    return NextResponse.json({
      success: true,
      count: normalized.length,
      sampleTitles: normalized.slice(0, 3).map(r => r.title),
    });
  } catch (err) {
    console.error('[/api/catalog POST]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

function parseCSV(text) {
  const lines = text.split('\n').filter(Boolean);
  if (lines.length < 2) return [];

  const headers = parseLine(lines[0]);
  const records = [];

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cols = parseLine(lines[i]);
    const record = {};
    headers.forEach((h, idx) => {
      record[h.trim().toLowerCase().replace(/\s+/g, '_')] = (cols[idx] || '').trim();
    });
    records.push(record);
  }

  return records;
}

function parseLine(line) {
  const cols = [];
  let inQuote = false;
  let current = '';
  for (const ch of line) {
    if (ch === '"') {
      inQuote = !inQuote;
    } else if (ch === ',' && !inQuote) {
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
  page_num: ['page_num', 'page'],
  product_url: ['product_url', 'url', 'href', 'link'],
  product_handle: ['product_handle', 'handle', 'slug'],
  title: ['title', 'name', 'product_title'],
  image_url: ['image_url', 'img_url', 'image', 'img'],
  image_alt: ['image_alt', 'alt', 'alt_text'],
  artwork_family: ['artwork_family', 'family', 'artwork_group'],
};

function normalizeRecord(record) {
  const normalized = {};
  for (const [normKey, aliases] of Object.entries(FIELD_MAP)) {
    for (const alias of aliases) {
      if (record[alias] !== undefined) {
        normalized[normKey] = record[alias];
        break;
      }
    }
    if (!normalized[normKey]) normalized[normKey] = '';
  }
  // Ensure URL is rooted
  if (normalized.product_url && !normalized.product_url.startsWith('http')) {
    if (!normalized.product_url.startsWith('/')) {
      normalized.product_url = '/' + normalized.product_url;
    }
  }
  return normalized;
}
