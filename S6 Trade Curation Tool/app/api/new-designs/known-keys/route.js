import { NextResponse } from 'next/server';
import { getPool, loadFormatConfig } from '../../../../lib/newDesigns.js';

export const dynamic = 'force-dynamic';
export const maxDuration = 26;

// GET /api/new-designs/known-keys
// Everything the browser needs to diff a catalog export locally:
//   haveCopy  — design_keys whose copy is already written (described)
//   inDbExtra — design_keys present in products but NOT yet described
//               (imported earlier, still pending/failed — don't re-import,
//               but DO store their pages so they get stamped this run)
//   slugs     — TYPE_SLUGS (longest first) for design_key derivation
//   types     — per product type: has a format sentence? flat art or mockup?
export async function GET() {
  try {
    const pool = getPool();
    const [copyRes, allRes, fmt] = await Promise.all([
      pool.query(`SELECT design_key FROM products
                  WHERE design_key IS NOT NULL AND description_status = 'described'`),
      pool.query(`SELECT design_key FROM products
                  WHERE design_key IS NOT NULL AND description_status <> 'described'`),
      loadFormatConfig(pool),
    ]);
    const haveCopy = copyRes.rows.map(r => r.design_key);
    const have = new Set(haveCopy);
    const inDbExtra = [...new Set(allRes.rows.map(r => r.design_key))].filter(k => !have.has(k));

    const types = {};
    for (const [ptype, cfg] of Object.entries(fmt.byType)) {
      types[ptype] = { flat: cfg.flat, hasSentence: true };
    }

    return NextResponse.json({
      haveCopy,
      inDbExtra,
      slugs: fmt.slugs,
      types,
    });
  } catch (err) {
    // 42P01 = table missing — tell the UI to show the setup button
    if (err.code === '42P01') {
      return NextResponse.json({ needsSetup: true, error: err.message }, { status: 200 });
    }
    console.error('known-keys error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
