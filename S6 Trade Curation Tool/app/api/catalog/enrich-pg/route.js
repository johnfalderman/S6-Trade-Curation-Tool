import { NextResponse } from 'next/server';

function getPool() {
  const pg = require('pg');
  const { Pool } = pg.default || pg;
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set.');
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 5,
  });
}

export async function GET() {
  try {
    const pool = getPool();
    const [summaryRes, runsRes, samplesRes] = await Promise.all([
      pool.query(`SELECT * FROM enrichment_summary ORDER BY category`),
      pool.query(`
        SELECT id, run_label, category_filter, run_status,
               total_queued, total_succeeded, total_failed, total_skipped,
               total_cost_usd, started_at, completed_at
        FROM enrichment_runs
        ORDER BY started_at DESC
        LIMIT 10
      `),
      pool.query(`
        SELECT
          p.s6_product_id, p.title, p.image_url, p.product_url,
          r.vision_summary, r.vision_subject, r.vision_style,
          r.vision_palette, r.vision_mood, r.vision_keywords
        FROM enrichment_results r
        JOIN products p ON p.id = r.product_id
        WHERE r.is_current = true
        ORDER BY r.created_at DESC
        LIMIT 6
      `),
    ]);
    await pool.end();
    return NextResponse.json({
      summary: summaryRes.rows,
      recentRuns: runsRes.rows,
      recentSamples: samplesRes.rows,
    });
  } catch (err) {
    console.error('enrich-pg GET error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured.' }, { status: 400 });
    }
    if (!process.env.DATABASE_URL) {
      return NextResponse.json({ error: 'DATABASE_URL not configured.' }, { status: 400 });
    }

    let body = {};
    try { body = await request.json(); } catch {}

    const batchSize   = Math.min(parseInt(body.batchSize  || 20, 10), 50);
    const concurrency = Math.min(parseInt(body.concurrency || 6, 10), 10);
    const category    = body.category || null;
    const force       = !!body.force;

    const { runEnrichmentBatch } = await import('../../../../lib/enrich.js');
    const result = await runEnrichmentBatch({ batchSize, concurrency, category, force, continuous: false });
    return NextResponse.json(result);
  } catch (err) {
    console.error('enrich-pg POST error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}