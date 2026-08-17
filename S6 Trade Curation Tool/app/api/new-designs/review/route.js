import { NextResponse } from 'next/server';
import {
  getPool, loadFormatConfig, buildBody, buildMeta, lintCopy, fixDesc, fixMeta, clampMeta,
} from '../../../../lib/newDesigns.js';

export const dynamic = 'force-dynamic';
export const maxDuration = 26;

// GET /api/new-designs/review?uploadId=N&limit=24&offset=0
// Described designs from this upload with the copy assembled exactly as it
// will publish (body for the design's representative type + prefixed meta),
// plus guardrail lint warnings so Jordan can spot-check quality.
export async function GET(request) {
  try {
    const pool = getPool();
    const params = new URL(request.url).searchParams;
    const uploadId = parseInt(params.get('uploadId'), 10);
    if (!uploadId) return NextResponse.json({ error: 'uploadId required' }, { status: 400 });
    const limit = Math.min(parseInt(params.get('limit') || '24', 10), 60);
    const offset = parseInt(params.get('offset') || '0', 10);

    const [{ rows }, fmt] = await Promise.all([
      pool.query(
        `SELECT p.id, p.design_key, p.title, p.image_url, p.product_type, p.description_status,
                er.artwork_description, er.context_clause, er.meta_description
         FROM products p
         LEFT JOIN enrichment_results er ON er.product_id = p.id AND er.is_current = true
         WHERE p.design_key IN (SELECT DISTINCT design_key FROM nd_pages WHERE upload_id = $1)
         ORDER BY p.title
         LIMIT $2 OFFSET $3`,
        [uploadId, limit, offset]
      ),
      loadFormatConfig(pool),
    ]);

    const items = rows.map(r => {
      const cfg = fmt.byType[r.product_type];
      const artwork = r.artwork_description || '';
      const context = r.context_clause || '';
      const meta = r.meta_description || '';
      const bodyPreview = artwork && cfg
        ? buildBody(artwork, context, cfg.sentence, cfg.drop_context)
        : null;
      const metaPreview = meta ? buildMeta(cfg ? cfg.meta_label : null, meta) : null;
      const warnings = [
        ...lintCopy(artwork).map(w => 'artwork: ' + w),
        ...lintCopy(context).map(w => 'context: ' + w),
        ...lintCopy(meta).map(w => 'meta: ' + w),
      ];
      if (metaPreview && metaPreview.length > 155) warnings.push(`meta is ${metaPreview.length} chars (cap 155)`);
      return {
        id: String(r.id),
        design_key: r.design_key,
        title: r.title,
        image_url: r.image_url,
        product_type: r.product_type,
        status: r.description_status,
        artwork, context, meta,
        bodyPreview, metaPreview,
        warnings,
      };
    });

    return NextResponse.json({ items });
  } catch (err) {
    console.error('review GET error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST /api/new-designs/review
//   { id, action: 'regenerate' }                      -> back to pending; next
//                                                        Generate run rewrites it
//   { id, action: 'save', artwork, context, meta }    -> manual edit, with the
//                                                        fix-copy pass applied
export async function POST(request) {
  try {
    const pool = getPool();
    const body = await request.json();
    const { id, action } = body;
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    if (action === 'regenerate') {
      await pool.query(
        `UPDATE products SET description_status = 'pending', updated_at = now() WHERE id::text = $1`,
        [String(id)]
      );
      return NextResponse.json({ ok: true });
    }

    if (action === 'save') {
      const artwork = fixDesc((body.artwork || '').trim());
      const context = (body.context || '').trim();
      let meta = clampMeta((body.meta || '').trim());
      const mf = fixMeta(meta);
      if (mf.changed) meta = mf.value;
      const warnings = [
        ...lintCopy(artwork).map(w => 'artwork: ' + w),
        ...lintCopy(context).map(w => 'context: ' + w),
        ...lintCopy(meta).map(w => 'meta: ' + w),
      ];
      const res = await pool.query(
        `UPDATE enrichment_results er SET
           artwork_description = $2, context_clause = $3, meta_description = $4
         FROM products p
         WHERE er.product_id = p.id AND er.is_current = true AND p.id::text = $1`,
        [String(id), artwork, context, meta]
      );
      if (res.rowCount === 0) return NextResponse.json({ error: 'no current copy row to update' }, { status: 404 });
      return NextResponse.json({ ok: true, artwork, context, meta, warnings });
    }

    return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  } catch (err) {
    console.error('review POST error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
