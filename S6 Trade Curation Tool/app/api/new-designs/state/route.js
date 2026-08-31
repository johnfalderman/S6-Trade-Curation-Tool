import { NextResponse } from 'next/server';
import { getPool } from '../../../../lib/newDesigns.js';

export const dynamic = 'force-dynamic';
export const maxDuration = 26;

// GET /api/new-designs/state[?uploadId=N]
// Dashboard state: recent uploads, format-sentence count, and (when an
// uploadId is given) that upload's generation progress.
export async function GET(request) {
  try {
    const pool = getPool();
    const uploadId = parseInt(new URL(request.url).searchParams.get('uploadId'), 10);

    let fmtCount = 0;
    let uploads = [];
    try {
      const [fmtRes, upRes] = await Promise.all([
        pool.query(`SELECT count(*)::int AS n FROM format_sentences`),
        pool.query(`SELECT id, label, filename, total_designs, total_pages, unknown_types, created_at
                    FROM nd_uploads ORDER BY created_at DESC LIMIT 8`),
      ]);
      fmtCount = fmtRes.rows[0].n;
      uploads = upRes.rows;
    } catch (e) {
      if (e.code === '42P01') return NextResponse.json({ needsSetup: true });
      throw e;
    }

    let progress = null;
    if (uploadId) {
      const { rows: [c] } = await pool.query(
        `SELECT
           count(*) FILTER (WHERE description_status = 'pending'
                              AND COALESCE(image_url, '') <> '')::int     AS pending,
           count(*) FILTER (WHERE description_status = 'pending'
                              AND COALESCE(image_url, '') = '')::int      AS no_image,
           count(*) FILTER (WHERE description_status = 'processing')::int AS processing,
           count(*) FILTER (WHERE description_status = 'failed')::int     AS failed,
           count(*) FILTER (WHERE description_status = 'described')::int  AS described,
           count(*)::int AS total
         FROM products
         WHERE design_key IN (SELECT DISTINCT design_key FROM nd_pages WHERE upload_id = $1)`,
        [uploadId]
      );
      progress = c;
    }

    return NextResponse.json({ needsSetup: false, formatTypes: fmtCount, uploads, progress });
  } catch (err) {
    console.error('state error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
