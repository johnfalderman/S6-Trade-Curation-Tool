import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import {
  getPool, loadFormatConfig,
  buildFlatPrompt, buildMockupPrompt, parseLayers, fetchImageAsBase64,
  fixDesc, fixMeta,
  MODEL_ID, PROMPT_VERSION_FLAT, PROMPT_VERSION_MOCKUP,
  COST_PER_INPUT_TOKEN, COST_PER_OUTPUT_TOKEN,
} from '../../../../lib/newDesigns.js';

export const dynamic = 'force-dynamic';
export const maxDuration = 26;

// POST /api/new-designs/describe { uploadId, batchSize?, concurrency? }
// Runs ONE batch of copy generation for the upload's designs, then returns.
// The browser calls this in a loop (same pattern as the enrichment page), so
// each request stays well inside the function time limit and the run is
// resume-safe: state lives in products.description_status, not in memory.
//
// Prompt choice per design: flat art types get the text-aware flat prompt
// (lib/describe.js), everything else gets the mockup-aware prompt
// (describe-mockup.js). fix-copy.mjs cleanup is applied before writing, so
// there is no separate fix step for Jordan to remember.

// Representative-image priority for the self-heal below — same order as the
// client's PRIO map in page.jsx (prefer flat white-bg wall art).
const REP_IMAGE_PRIO = [
  'Art Print', 'Poster', 'Mini Art Print', 'Canvas Print', 'Metal Print',
  'Framed Art Print', 'Framed Canvas Print', 'Framed Poster', 'Foil Art Print',
  'Wood Wall Art', 'Wall Tapestry', 'Wall Mural', 'Wall Hanging', 'Wallpaper',
];

async function describeOne(product, promptKind, anthropic) {
  if (!product.image_url) throw new Error('no image_url');
  const { base64, mediaType } = await fetchImageAsBase64(product.image_url);
  const prompt = promptKind === 'flat'
    ? buildFlatPrompt(product.title || '')
    : buildMockupPrompt(product.title || '');
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const message = await anthropic.messages.create({
        model: MODEL_ID,
        max_tokens: 700,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
            { type: 'text', text: prompt },
          ],
        }],
      });
      const inputTokens = message.usage?.input_tokens || 0;
      const outputTokens = message.usage?.output_tokens || 0;
      const costUsd = inputTokens * COST_PER_INPUT_TOKEN + outputTokens * COST_PER_OUTPUT_TOKEN;
      const layers = parseLayers(message.content[0].text.trim());
      if (!layers.artwork_description) throw new Error('could not parse ARTWORK from response');
      // fix-copy.mjs pass, applied at write time
      layers.artwork_description = fixDesc(layers.artwork_description);
      const mf = fixMeta(layers.meta_description);
      if (mf.changed) layers.meta_description = mf.value;
      return { layers, inputTokens, outputTokens, costUsd };
    } catch (e) {
      lastErr = e;
      const status = e?.status || e?.response?.status;
      const msg = (e?.message || '').toLowerCase();
      if (status === 429 || status === 529 || msg.includes('rate') || msg.includes('overload')) {
        if (attempt === 0) { await new Promise(r => setTimeout(r, 1500)); continue; }
      }
      throw e;
    }
  }
  throw lastErr || new Error('description failed');
}

async function writeDescription(pool, productId, layers, tokens, promptVersion) {
  const { rows } = await pool.query(
    `SELECT id FROM enrichment_results WHERE product_id = $1 AND is_current = true LIMIT 1`,
    [productId]
  );
  if (rows.length > 0) {
    await pool.query(
      `UPDATE enrichment_results SET artwork_description = $2, context_clause = $3, meta_description = $4,
         vision_subject = $5, vision_style = $6, vision_palette = $7, vision_mood = $8, vision_keywords = $9,
         model_id = $10, prompt_version = $11 WHERE id = $1`,
      [rows[0].id, layers.artwork_description, layers.context_clause, layers.meta_description,
        layers.vision_subject, layers.vision_style, layers.vision_palette, layers.vision_mood, layers.vision_keywords,
        MODEL_ID, promptVersion]
    );
  } else {
    await pool.query(
      `INSERT INTO enrichment_results (product_id, model_id, prompt_version, is_current,
         artwork_description, context_clause, meta_description,
         vision_subject, vision_style, vision_palette, vision_mood, vision_keywords,
         input_tokens, output_tokens, estimated_cost_usd)
       VALUES ($1,$2,$3,true,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [productId, MODEL_ID, promptVersion,
        layers.artwork_description, layers.context_clause, layers.meta_description,
        layers.vision_subject, layers.vision_style, layers.vision_palette, layers.vision_mood, layers.vision_keywords,
        tokens.inputTokens, tokens.outputTokens, tokens.costUsd]
    );
  }
  await pool.query(
    `UPDATE products SET description_status = 'described',
       description_attempts = description_attempts + 1,
       description_error = null, updated_at = now() WHERE id = $1`,
    [productId]
  );
}

export async function POST(request) {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured.' }, { status: 400 });
    }
    const pool = getPool();
    let body = {};
    try { body = await request.json(); } catch {}
    const uploadId = parseInt(body.uploadId, 10);
    if (!uploadId) return NextResponse.json({ error: 'uploadId required' }, { status: 400 });
    const batchSize = Math.min(parseInt(body.batchSize || 12, 10), 20);
    const concurrency = Math.min(parseInt(body.concurrency || 6, 10), 8);
    const retryFailed = !!body.retryFailed;

    // SELF-HEAL: an earlier upload may have imported these designs WITHOUT an
    // image (e.g. an export whose Image Src column was missing/empty). Those
    // rows sit 'pending' forever because the work query below requires an
    // image. If THIS upload's registered pages carry image URLs for the same
    // design_keys, adopt one (preferring flat wall-art pages, same priority
    // as the client's representative-row pick) before selecting work.
    await pool.query(
      `UPDATE products p
       SET image_url = src.image_url, updated_at = now()
       FROM (
         SELECT DISTINCT ON (design_key) design_key, image_url
         FROM nd_pages
         WHERE upload_id = $1 AND COALESCE(image_url, '') <> ''
         ORDER BY design_key,
           COALESCE(array_position($2::text[], product_type), 999)
       ) src
       WHERE p.design_key = src.design_key
         AND COALESCE(p.image_url, '') = ''
         AND p.description_status <> 'described'`,
      [uploadId, REP_IMAGE_PRIO]
    );

    // recover rows a crashed/timed-out request left in 'processing' (scoped)
    await pool.query(
      `UPDATE products SET description_status = 'pending'
       WHERE description_status = 'processing'
         AND design_key IN (SELECT DISTINCT design_key FROM nd_pages WHERE upload_id = $1)`,
      [uploadId]
    );

    const statuses = retryFailed ? ['pending', 'failed'] : ['pending'];
    const { rows: products } = await pool.query(
      `SELECT id, design_key, title, image_url, product_type
       FROM products
       WHERE description_status = ANY($2::description_status[])
         AND image_url IS NOT NULL AND image_url <> ''
         AND design_key IN (SELECT DISTINCT design_key FROM nd_pages WHERE upload_id = $1)
       ORDER BY created_at ASC
       LIMIT $3`,
      [uploadId, statuses, batchSize]
    );

    const fmt = await loadFormatConfig(pool);
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const stats = { succeeded: 0, failed: 0, costUsd: 0, failures: [] };

    if (products.length > 0) {
      // id::text comparison works whether products.id is uuid or integer
      await pool.query(
        `UPDATE products SET description_status = 'processing', updated_at = now()
         WHERE id::text = ANY($1::text[])`,
        [products.map(p => String(p.id))]
      );

      let next = 0;
      async function pump() {
        while (true) {
          const i = next++;
          if (i >= products.length) return;
          const p = products[i];
          const cfg = fmt.byType[p.product_type];
          const promptKind = cfg && cfg.flat ? 'flat' : 'mockup';
          const promptVersion = promptKind === 'flat' ? PROMPT_VERSION_FLAT : PROMPT_VERSION_MOCKUP;
          try {
            const { layers, inputTokens, outputTokens, costUsd } = await describeOne(p, promptKind, anthropic);
            await writeDescription(pool, p.id, layers, { inputTokens, outputTokens, costUsd }, promptVersion);
            stats.succeeded++;
            stats.costUsd += costUsd;
          } catch (err) {
            await pool.query(
              `UPDATE products SET description_status = 'failed',
                 description_attempts = description_attempts + 1,
                 description_error = $2, updated_at = now() WHERE id = $1`,
              [p.id, String(err.message || err).slice(0, 500)]
            ).catch(() => {});
            stats.failed++;
            if (stats.failures.length < 5) stats.failures.push({ title: p.title, error: String(err.message || err) });
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(concurrency, products.length) }, pump));
    }

    const { rows: [counts] } = await pool.query(
      `SELECT
         count(*) FILTER (WHERE description_status = 'pending'
                            AND COALESCE(image_url, '') <> '')::int    AS pending,
         count(*) FILTER (WHERE description_status = 'pending'
                            AND COALESCE(image_url, '') = '')::int     AS no_image,
         count(*) FILTER (WHERE description_status = 'failed')::int    AS failed,
         count(*) FILTER (WHERE description_status = 'described')::int AS described
       FROM products
       WHERE design_key IN (SELECT DISTINCT design_key FROM nd_pages WHERE upload_id = $1)`,
      [uploadId]
    );

    // remaining = actionable work only. Counting imageless pending rows here
    // made the browser's generate loop spin forever on designs it could
    // never process.
    return NextResponse.json({ ...stats, remaining: counts.pending, counts });
  } catch (err) {
    console.error('new-designs describe error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
