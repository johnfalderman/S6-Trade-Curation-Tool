import { NextResponse } from 'next/server';
import { getStore } from '@netlify/blobs';
import { gunzipSync } from 'zlib';

const BLOB_STORE = 'catalog';

export async function GET() {
  try {
    const store = getStore(BLOB_STORE);
    const meta = await store.get('meta', { type: 'json' }).catch(() => null);
    if (meta) {
      // Augment with vision-enrichment status so the UI can render
      // "X of Y enriched" without an extra round-trip to /api/catalog/enrich.
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

export async function POST(request) {
  try {
    const body = await request.json();
    let records = [];

    if (body.gzip) {
      // Gzip-compressed payload: base64 -> Buffer -> gunzip -> JSON
      const compressed = Buffer.from(body.gzip, 'base64');
      const json = gunzipSync(compressed).toString('utf-8');
      const parsed = JSON.parse(json);
      records = expandCompact(parsed.compact || []);
    } else if (body.compact && Array.isArray(body.compact)) {
      records = expandCompact(body.compact);
    } else {
      return NextResponse.json(
        { error: 'Expected { gzip: "base64string" } or { compact: [...] }' },
        { status: 400 }
      );
    }

    if (!records.length) {
      return NextResponse.json({ error: 'No valid records found' }, { status: 400 });
    }

    // Save to Netlify Blobs for persistence across function invocations
    const store = getStore(BLOB_STORE);
    await store.set('records', JSON.stringify(records));
    await store.set('meta', JSON.stringify({ source: 'real', count: records.length, loadedAt: new Date().toISOString() }));
    // Reset enrichment progress — a new catalog upload invalidates any
    // previously-tracked vision enrichment state. Records themselves carry
    // their `visionStyle` fields, so re-uploading the same CSV won't lose
    // existing enrichment if the records still match.
    await store.set('enrichment-meta', JSON.stringify({
      totalRecords: records.length,
      enrichedCount: 0,
      lastProcessedIndex: 0,
      status: 'idle',
      updatedAt: new Date().toISOString(),
    })).catch(() => {});
    // Clear the sample buffer too — old samples reference rows from the
    // previous catalog and would be misleading after a fresh upload.
    await store.set('enrichment-samples', JSON.stringify([])).catch(() => {});

    return NextResponse.json({
      success: true,
      count: records.length,
      message: `Catalog saved with ${records.length} tagged records`,
    });
  } catch (err) {
    console.error('Catalog POST error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

function expandCompact(compact) {
  return compact
    .filter(r => r.u)
    .map(r => ({
      title: r.t || '',
      product_url: r.u || '',
      product_handle: r.h || '',
      source_collection: r.c || '',
      image_url: r.i || '',
      image_alt: r.a || '',
    }));
}
