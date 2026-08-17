import { NextResponse } from 'next/server';
import { getPool, loadFormatConfig, buildBody, buildMeta } from '../../../../lib/newDesigns.js';

export const dynamic = 'force-dynamic';
export const maxDuration = 26;

// GET /api/new-designs/export?uploadId=N[&sample=20][&counts=1]
// Builds the Matrixify MERGE delta CSV for this upload — the exact stamp.py
// output shape. MERGE + only these columns means every other Shopify field is
// left untouched. Skip rules are stamp.py's verbatim: no copy yet, blank
// artwork, unknown type (no format sentence), Foil Art Print.
//
// Header must stay BYTE-EXACT or the Matrixify import fails silently:
//   ID,Handle,Command,Body HTML,Metafield: description_tag [string]

const SEO_DESC_COL = 'Metafield: description_tag [string]';

function csvField(v) {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export async function GET(request) {
  try {
    const pool = getPool();
    const params = new URL(request.url).searchParams;
    const uploadId = parseInt(params.get('uploadId'), 10);
    if (!uploadId) return NextResponse.json({ error: 'uploadId required' }, { status: 400 });
    const sample = parseInt(params.get('sample') || '0', 10);
    const countsOnly = params.get('counts') === '1';

    const [{ rows: pages }, fmt] = await Promise.all([
      pool.query(
        `SELECT DISTINCT ON (np.handle)
                np.page_id, np.handle, np.product_type,
                er.artwork_description, er.context_clause, er.meta_description,
                p.description_status
         FROM nd_pages np
         LEFT JOIN products p ON p.design_key = np.design_key AND p.description_status = 'described'
         LEFT JOIN enrichment_results er ON er.product_id = p.id AND er.is_current = true
         WHERE np.upload_id = $1
         ORDER BY np.handle`,
        [uploadId]
      ),
      loadFormatConfig(pool),
    ]);

    const counts = { written: 0, missing_copy: 0, blank_art: 0, unknown_type: 0, foil: 0 };
    const typeMix = {};
    const lines = ['ID,Handle,Command,Body HTML,' + csvField(SEO_DESC_COL)];
    const seen = new Set();

    for (const row of pages) {
      if (sample && counts.written >= sample) break;
      if (seen.has(row.handle)) continue;
      seen.add(row.handle);

      if (row.product_type === 'Foil Art Print') { counts.foil++; continue; }
      const cfg = fmt.byType[row.product_type];
      if (!cfg) { counts.unknown_type++; continue; }
      if (row.description_status !== 'described' || row.artwork_description == null) {
        counts.missing_copy++; continue;
      }
      if (!row.artwork_description.trim()) { counts.blank_art++; continue; }

      const body = buildBody(row.artwork_description, row.context_clause || '', cfg.sentence, cfg.drop_context);
      const seo = buildMeta(cfg.meta_label, row.meta_description || '');
      lines.push([
        csvField(row.page_id || ''),
        csvField(row.handle),
        'MERGE',
        csvField(body),
        csvField(seo),
      ].join(','));
      counts.written++;
      typeMix[row.product_type] = (typeMix[row.product_type] || 0) + 1;
    }

    if (countsOnly) {
      return NextResponse.json({ counts, typeMix, totalPages: pages.length });
    }

    const filename = sample
      ? `s6_new_designs_SAMPLE_upload${uploadId}.csv`
      : `s6_new_designs_delta_upload${uploadId}.csv`;
    // \r\n to match Python csv.writer output byte-for-byte (what Jordan imports today)
    return new NextResponse(lines.join('\r\n') + '\r\n', {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'X-Written': String(counts.written),
      },
    });
  } catch (err) {
    console.error('export error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
