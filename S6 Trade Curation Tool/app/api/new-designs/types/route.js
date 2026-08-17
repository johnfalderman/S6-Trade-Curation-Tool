import { NextResponse } from 'next/server';
import { getPool, slugForType, lintCopy } from '../../../../lib/newDesigns.js';

export const dynamic = 'force-dynamic';
export const maxDuration = 26;

// GET /api/new-designs/types[?uploadId=N]
//   All format sentences, plus (when uploadId given) product types that appear
//   in that upload's pages but have NO sentence yet — those pages are blocked
//   from stamping until Jordan writes and approves one.
export async function GET(request) {
  try {
    const pool = getPool();
    const uploadId = parseInt(new URL(request.url).searchParams.get('uploadId'), 10);

    const { rows: sentences } = await pool.query(
      `SELECT product_type, sentence, meta_label, type_slug, drop_context, flat, approved_by, updated_at
       FROM format_sentences ORDER BY product_type`
    );

    let missing = [];
    if (uploadId) {
      const { rows } = await pool.query(
        `SELECT p.product_type AS type, count(*)::int AS pages
         FROM nd_pages p
         LEFT JOIN format_sentences f ON f.product_type = p.product_type
         WHERE p.upload_id = $1 AND f.product_type IS NULL
         GROUP BY p.product_type ORDER BY pages DESC`,
        [uploadId]
      );
      missing = rows.filter(r => r.type !== 'Foil Art Print'); // Foil is excluded on purpose
    }

    return NextResponse.json({ sentences, missing });
  } catch (err) {
    console.error('types GET error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST /api/new-designs/types
//   { product_type, sentence, meta_label?, drop_context?, flat? }
//   Upserts a format sentence. Existing sentences seeded from stamp.py are
//   Jordan-approved and final; this endpoint exists mainly for brand-NEW
//   product types. Guardrail lint runs and is returned as warnings, but the
//   save still goes through — Jordan owns format sign-off.
export async function POST(request) {
  try {
    const pool = getPool();
    const body = await request.json();
    const productType = (body.product_type || '').trim();
    const sentence = (body.sentence || '').trim();
    if (!productType || !sentence) {
      return NextResponse.json({ error: 'product_type and sentence are required' }, { status: 400 });
    }

    const warnings = lintCopy(sentence, { isFormatSentence: true });
    const typeSlug = slugForType(productType);
    const metaLabel = (body.meta_label || '').trim() || null;

    await pool.query(
      `INSERT INTO format_sentences
         (product_type, sentence, meta_label, type_slug, drop_context, flat, approved_by, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,'Jordan (UI)', now())
       ON CONFLICT (product_type) DO UPDATE SET
         sentence = EXCLUDED.sentence,
         meta_label = EXCLUDED.meta_label,
         drop_context = EXCLUDED.drop_context,
         flat = EXCLUDED.flat,
         approved_by = EXCLUDED.approved_by,
         updated_at = now()`,
      [productType, sentence, metaLabel, typeSlug, !!body.drop_context, !!body.flat]
    );

    return NextResponse.json({ ok: true, type_slug: typeSlug, warnings });
  } catch (err) {
    console.error('types POST error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
