import { NextResponse } from 'next/server';
import pg from 'pg';

export const dynamic = 'force-dynamic';

// GET /api/product-types
// Returns how many designs are available in each product type, from
// design_formats: { counts: { "Art Print": 63805, "Throw Pillow": 57829, ... } }.
// Powers the count shown beside each product-type checkbox on the home screen.

let _pool = null;
function getPool() {
  if (!_pool) {
    _pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 3, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000,
    });
    _pool.on('error', () => {});
  }
  return _pool;
}

export async function GET() {
  if (!process.env.DATABASE_URL) return NextResponse.json({ counts: {} });
  try {
    const { rows } = await getPool().query(
      `SELECT product_type, count(*)::int AS n FROM design_formats GROUP BY product_type`
    );
    const counts = {};
    for (const r of rows) counts[r.product_type] = r.n;
    return NextResponse.json({ counts });
  } catch (e) {
    // design_formats may not exist yet — degrade gracefully (no counts shown).
    return NextResponse.json({ counts: {}, error: e.message });
  }
}
