import { NextResponse } from 'next/server';
import { getPool } from '../../../../lib/newDesigns.js';
import { FORMAT_SEED } from '../../../../lib/formatSeed.js';

export const dynamic = 'force-dynamic';
export const maxDuration = 26;

// POST /api/new-designs/setup
// Idempotent: creates the new-designs tables if missing and seeds the
// Jordan-approved format sentences from stamp.py. Seeding is ON CONFLICT DO
// NOTHING, so sentences edited in the UI are never overwritten. Safe to click
// any number of times.
export async function POST() {
  try {
    const pool = getPool();

    await pool.query(`
      CREATE TABLE IF NOT EXISTS format_sentences (
        product_type text PRIMARY KEY,
        sentence     text NOT NULL,
        meta_label   text,
        type_slug    text NOT NULL,
        drop_context boolean NOT NULL DEFAULT false,
        flat         boolean NOT NULL DEFAULT false,
        approved_by  text,
        updated_at   timestamptz NOT NULL DEFAULT now()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS nd_uploads (
        id            serial PRIMARY KEY,
        label         text,
        filename      text,
        total_designs int NOT NULL DEFAULT 0,
        total_pages   int NOT NULL DEFAULT 0,
        unknown_types jsonb NOT NULL DEFAULT '[]',
        created_at    timestamptz NOT NULL DEFAULT now()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS nd_pages (
        id           bigserial PRIMARY KEY,
        upload_id    int NOT NULL REFERENCES nd_uploads(id) ON DELETE CASCADE,
        page_id      text,
        handle       text NOT NULL,
        product_type text NOT NULL,
        design_key   text NOT NULL,
        UNIQUE (upload_id, handle)
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS nd_pages_design_key_idx ON nd_pages(design_key)`);

    let seeded = 0;
    for (const [ptype, cfg] of Object.entries(FORMAT_SEED)) {
      const res = await pool.query(
        `INSERT INTO format_sentences
           (product_type, sentence, meta_label, type_slug, drop_context, flat, approved_by)
         VALUES ($1,$2,$3,$4,$5,$6,'Jordan (seeded from stamp.py)')
         ON CONFLICT (product_type) DO NOTHING`,
        [ptype, cfg.sentence, cfg.meta_label, cfg.type_slug, cfg.drop_context, cfg.flat]
      );
      seeded += res.rowCount;
    }

    const { rows: [{ n }] } = await pool.query(`SELECT count(*)::int AS n FROM format_sentences`);
    return NextResponse.json({ ok: true, seeded, totalTypes: n });
  } catch (err) {
    console.error('new-designs setup error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
