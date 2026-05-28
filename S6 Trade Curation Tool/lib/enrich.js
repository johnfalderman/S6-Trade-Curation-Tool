/**
 * S6 Catalog Enrichment Service — Enrichment Pipeline
 * =====================================================
 * Reads 'pending' products from Postgres, runs each image
 * through Claude vision, and writes structured results back.
 *
 * Usage:
 *   import { runEnrichmentBatch, getEnrichmentStats } from './enrich.js'
 *
 *   // Run a batch of 50 products
 *   await runEnrichmentBatch({ batchSize: 50, concurrency: 6 })
 *
 *   // Run continuously until all pending products are enriched
 *   await runEnrichmentBatch({ batchSize: 50, concurrency: 6, continuous: true })
 *
 * CLI:
 *   node enrich.js                        # run one batch (default 50)
 *   node enrich.js --continuous           # run until all pending done
 *   node enrich.js --batch-size=100       # custom batch size
 *   node enrich.js --category=home_decor  # scope to one category
 *   node enrich.js --force                # re-enrich already-enriched products
 *
 * Environment variables required:
 *   DATABASE_URL      — Postgres connection string
 *   ANTHROPIC_API_KEY — Claude API key
 *
 * Dependencies (already installed):
 *   npm install pg
 *   npm install @anthropic-ai/sdk
 */

import pg from 'pg';
import Anthropic from '@anthropic-ai/sdk';

const { Pool } = pg;


// ── DB connection ─────────────────────────────────────────────

let _pool = null;

function getPool() {
  if (!_pool) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set.');
    _pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 10,
    });
  }
  return _pool;
}


// ── Vocabulary (kept in sync with existing enrich/route.js) ──

const SUBJECT_VOCAB = [
  'music', 'coastal', 'floral', 'landscape', 'urban', 'animal',
  'southern', 'typography', 'abstract', 'food-drink', 'monochrome',
];

const STYLE_VOCAB = [
  'modern', 'vintage', 'retro', 'abstract', 'photography', 'coastal',
  'dramatic', 'music', 'urban', 'bohemian', 'minimalist', 'rustic',
  'floral', 'landscape', 'illustration', 'line-art', 'watercolor',
  'pop-art', 'mid-century', 'art-deco', 'food-drink', 'monochrome',
  'whimsical', 'elegant', 'graphic', 'hand-drawn', 'ink', 'sketch',
  'folk-art', 'tropical', 'celestial', 'anatomical', 'architectural', 'light',
];

const PALETTE_VOCAB = [
  'black', 'white', 'bw', 'monochrome', 'blue', 'navy', 'teal', 'green',
  'sage', 'red', 'burgundy', 'orange', 'terracotta', 'pink', 'purple',
  'gold', 'metallic', 'neutral', 'warm', 'cool', 'earthy', 'muted',
  'pastel', 'vibrant',
];

const MODEL_ID     = 'claude-haiku-4-5-20251001';
const PROMPT_VERSION = 'v1';

// Cost per token in USD (Haiku pricing as of 2025)
const COST_PER_INPUT_TOKEN  = 0.00000025;  // $0.25 / 1M
const COST_PER_OUTPUT_TOKEN = 0.00000125;  // $1.25 / 1M


// ── Claude vision prompt (identical to existing route.js) ────

function buildPrompt() {
  return `You are an expert art curator analyzing a single artwork image from Society6. Look carefully at the image and tag it for a recommendation system.

Identify:
- The actual visual content: what is depicted?
- The artistic style and medium: line drawing, watercolor, photograph, illustration, etc.
- The dominant colors
- The mood/feeling
- Search keywords that would appear in similar artwork titles or descriptions

Return ONLY valid JSON (no markdown, no explanation) with exactly these fields:
{
  "visionStyle": ["5-10 art style keywords drawn from this vocabulary (add new ones only if needed): ${STYLE_VOCAB.join(', ')}"],
  "visionPalette": ["3-8 dominant color keywords drawn from: ${PALETTE_VOCAB.join(', ')}"],
  "visionSubject": ["1-3 PRIMARY subject categories from this exact vocabulary: ${SUBJECT_VOCAB.join(', ')}. 'food-drink' = cocktails, wine, coffee, bar art, culinary. 'monochrome' = black-and-white, ink, line drawings."],
  "visionMood": ["2-4 mood words: playful, sophisticated, moody, whimsical, elegant, gritty, serene, dramatic, retro, modern, minimal, romantic, edgy, cheerful, melancholy"],
  "visionKeywords": ["10-20 concrete words that would appear in similar artwork titles or alt text — be very specific: 'cocktail', 'martini', 'saxophone', 'cobalt', 'terracotta', 'geometric', 'botanical', 'cityscape'"],
  "visionSummary": "1 short sentence describing the artwork's visual identity"
}`;
}


// ── Image fetching ────────────────────────────────────────────

function ensureSmallWidth(url) {
  // Society6 CDN URLs have specific width requirements — return as-is.
  // The width=3840 in the URL is fine for Claude vision analysis.
  return url;
}

async function fetchImageAsBase64(imageUrl) {
  console.log('FETCH URL:', imageUrl);
  const fullUrl = imageUrl.startsWith('/')
    ? 'https://society6.com' + imageUrl
    : imageUrl;
  const sized = ensureSmallWidth(fullUrl);

  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(sized, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; S6EnrichmentBot/1.0)',
          'Accept': 'image/*',
        },
        signal: AbortSignal.timeout(6000),
        redirect: 'follow',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const contentType = res.headers.get('content-type') || 'image/jpeg';
      const mediaType = contentType.split(';')[0].trim();
      const buffer = await res.arrayBuffer();
      const base64 = Buffer.from(buffer).toString('base64');
      return { base64, mediaType };
    } catch (e) {
      lastErr = e;
      if (attempt === 0) await sleep(250);
    }
  }
  throw lastErr || new Error('image fetch failed');
}


// ── Claude vision analysis ────────────────────────────────────

function normalizeAnalysis(parsed) {
  const lower = (a) =>
    (Array.isArray(a) ? a : [])
      .map(s => String(s).toLowerCase().trim())
      .filter(Boolean);

  return {
    vision_style:    lower(parsed.visionStyle),
    vision_palette:  lower(parsed.visionPalette),
    vision_subject:  lower(parsed.visionSubject).filter(s => SUBJECT_VOCAB.includes(s)),
    vision_mood:     lower(parsed.visionMood),
    vision_keywords: lower(parsed.visionKeywords),
    vision_summary:  typeof parsed.visionSummary === 'string'
                       ? parsed.visionSummary.slice(0, 280)
                       : '',
  };
}

async function analyzeProduct(product, anthropicClient) {
  if (!product.image_url) throw new Error('no image_url');

  const { base64, mediaType } = await fetchImageAsBase64(product.image_url);

  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const message = await anthropicClient.messages.create({
        model: MODEL_ID,
        max_tokens: 600,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
            { type: 'text', text: buildPrompt() },
          ],
        }],
      });

      const inputTokens  = message.usage?.input_tokens  || 0;
      const outputTokens = message.usage?.output_tokens || 0;
      const costUsd = (inputTokens * COST_PER_INPUT_TOKEN) +
                      (outputTokens * COST_PER_OUTPUT_TOKEN);

      let raw = message.content[0].text.trim();
      raw = raw.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '');
      const parsed = JSON.parse(raw);
      const analysis = normalizeAnalysis(parsed);

      return { analysis, inputTokens, outputTokens, costUsd };
    } catch (e) {
      lastErr = e;
      const status = e?.status || e?.response?.status;
      const msg = (e?.message || '').toLowerCase();
      if (status === 429 || status === 529 || msg.includes('rate') || msg.includes('overload')) {
        if (attempt === 0) { await sleep(1500); continue; }
      }
      throw e;
    }
  }
  throw lastErr || new Error('vision analysis failed');
}


// ── DB writes ─────────────────────────────────────────────────

async function markProcessing(client, productId) {
  await client.query(
    `UPDATE products SET enrichment_status = 'processing', updated_at = now()
     WHERE id = $1`,
    [productId]
  );
}

async function writeEnrichmentResult(client, productId, analysis, tokens) {
  // Mark any previous result as no longer current
  await client.query(
    `UPDATE enrichment_results SET is_current = false WHERE product_id = $1`,
    [productId]
  );

  // Insert new result
  await client.query(
    `INSERT INTO enrichment_results (
      product_id, model_id, prompt_version, is_current,
      vision_summary, vision_subject, vision_style,
      vision_palette, vision_mood, vision_keywords,
      input_tokens, output_tokens, estimated_cost_usd
    ) VALUES ($1,$2,$3,true,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      productId,
      MODEL_ID,
      PROMPT_VERSION,
      analysis.vision_summary,
      analysis.vision_subject,
      analysis.vision_style,
      analysis.vision_palette,
      analysis.vision_mood,
      analysis.vision_keywords,
      tokens.inputTokens,
      tokens.outputTokens,
      tokens.costUsd,
    ]
  );

  // Update product status
  await client.query(
    `UPDATE products SET
       enrichment_status = 'enriched',
       enrichment_attempts = enrichment_attempts + 1,
       enrichment_error = null,
       last_enriched_at = now(),
       updated_at = now()
     WHERE id = $1`,
    [productId]
  );
}

async function markFailed(client, productId, errorMessage) {
  await client.query(
    `UPDATE products SET
       enrichment_status = 'failed',
       enrichment_attempts = enrichment_attempts + 1,
       enrichment_error = $2,
       updated_at = now()
     WHERE id = $1`,
    [productId, errorMessage]
  );
}

async function updateRunStats(client, runId, stats) {
  await client.query(
    `UPDATE enrichment_runs SET
       total_processed     = total_processed     + $2,
       total_succeeded     = total_succeeded     + $3,
       total_failed        = total_failed        + $4,
       total_skipped       = total_skipped       + $5,
       total_input_tokens  = total_input_tokens  + $6,
       total_output_tokens = total_output_tokens + $7,
       total_cost_usd      = total_cost_usd      + $8
     WHERE id = $1`,
    [
      runId,
      stats.processed,
      stats.succeeded,
      stats.failed,
      stats.skipped,
      stats.inputTokens,
      stats.outputTokens,
      stats.costUsd,
    ]
  );
}


// ── Bounded concurrency ───────────────────────────────────────

async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function pump() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, pump));
  return results;
}


// ── Public: run one enrichment batch ─────────────────────────

/**
 * Fetch a batch of pending products and enrich them.
 *
 * @param {object} options
 * @param {number}  [options.batchSize=50]     - Products per batch
 * @param {number}  [options.concurrency=6]    - Parallel Claude calls
 * @param {string}  [options.category]         - Scope to one category
 * @param {boolean} [options.force=false]      - Re-enrich already-enriched products
 * @param {boolean} [options.continuous=false] - Keep running until no pending remain
 * @param {string}  [options.runLabel]         - Human label for this run
 * @returns {Promise<BatchResult>}
 */
export async function runEnrichmentBatch(options = {}) {
  const {
    batchSize   = 50,
    concurrency = 6,
    category    = null,
    force       = false,
    continuous  = false,
    runLabel    = null,
  } = options;

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set.');
  }

  const pool = getPool();
  const anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Create a run record
  const { rows: [run] } = await pool.query(
    `INSERT INTO enrichment_runs (run_label, category_filter, status_filter)
     VALUES ($1, $2, 'pending') RETURNING id`,
    [runLabel || `batch_${Date.now()}`, category || null]
  );
  const runId = run.id;

  const totals = {
    processed: 0, succeeded: 0, failed: 0, skipped: 0,
    inputTokens: 0, outputTokens: 0, costUsd: 0,
  };

  let keepGoing = true;

  while (keepGoing) {
    // Fetch next batch of pending products
    const statusValues = force
      ? ['pending', 'failed', 'enriched']
      : ['pending', 'failed'];
    const categoryClause = category ? `AND category = $3::product_category` : '';
    const queryParams = category ? [batchSize, statusValues, category] : [batchSize, statusValues];

    const { rows: products } = await pool.query(
      `SELECT id, s6_product_id, title, image_url
       FROM products
       WHERE enrichment_status = ANY($2::enrichment_status[])
       ${categoryClause}
       ORDER BY created_at ASC
       LIMIT $1`,
      queryParams
    );

    if (products.length === 0) {
      console.log('  ✓ No more pending products.');
      break;
    }

    // Update queued count on run record
    await pool.query(
      `UPDATE enrichment_runs SET total_queued = total_queued + $2 WHERE id = $1`,
      [runId, products.length]
    );

    console.log(`\n  Processing batch of ${products.length} products...`);

    // Mark all as processing
    const client = await pool.connect();
    try {
      await Promise.all(products.map(p => markProcessing(client, p.id)));
    } finally {
      client.release();
    }

    // Run vision analysis with bounded concurrency
    const batchStats = {
      processed: 0, succeeded: 0, failed: 0, skipped: 0,
      inputTokens: 0, outputTokens: 0, costUsd: 0,
    };

    await runWithConcurrency(products, concurrency, async (product) => {
      const dbClient = await pool.connect();
      try {
        const { analysis, inputTokens, outputTokens, costUsd } =
          await analyzeProduct(product, anthropicClient);

        await writeEnrichmentResult(dbClient, product.id, analysis, {
          inputTokens, outputTokens, costUsd,
        });

        batchStats.succeeded++;
        batchStats.inputTokens  += inputTokens;
        batchStats.outputTokens += outputTokens;
        batchStats.costUsd      += costUsd;

        process.stdout.write(
          `\r  ✓ ${batchStats.succeeded + batchStats.failed}/${products.length} ` +
          `| cost so far: $${(totals.costUsd + batchStats.costUsd).toFixed(4)}`
        );
      } catch (err) {
        await markFailed(dbClient, product.id, err.message);
        batchStats.failed++;
        console.error(`\n  ✗ Failed: ${product.title} — ${err.message}`);
      } finally {
        batchStats.processed++;
        dbClient.release();
      }
    });

    // Update run record with batch stats
    await updateRunStats(pool, runId, batchStats);

    // Accumulate totals
    for (const key of Object.keys(totals)) {
      totals[key] += batchStats[key];
    }

    console.log(`\n  Batch done: ${batchStats.succeeded} enriched, ${batchStats.failed} failed | $${batchStats.costUsd.toFixed(4)}`);

    // Only loop if continuous mode and we got a full batch
    // (partial batch = nothing left to process)
    keepGoing = continuous && products.length === batchSize;

    // Brief pause between continuous batches to avoid rate limits
    if (keepGoing) await sleep(500);
  }

  // Mark run complete
  await pool.query(
    `UPDATE enrichment_runs SET
       run_status = 'completed', completed_at = now()
     WHERE id = $1`,
    [runId]
  );

  console.log(`\n✅ Run complete.`);
  console.log(`   Enriched:  ${totals.succeeded.toLocaleString()}`);
  console.log(`   Failed:    ${totals.failed.toLocaleString()}`);
  console.log(`   Total cost: $${totals.costUsd.toFixed(4)}`);
  console.log(`   Tokens in:  ${totals.inputTokens.toLocaleString()}`);
  console.log(`   Tokens out: ${totals.outputTokens.toLocaleString()}`);

  return { runId, ...totals };
}


// ── Public: stats ─────────────────────────────────────────────

export async function getEnrichmentStats() {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT * FROM enrichment_summary ORDER BY category`
  );
  return rows;
}

export async function getRecentRuns(limit = 10) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT * FROM enrichment_runs ORDER BY started_at DESC LIMIT $1`,
    [limit]
  );
  return rows;
}


// ── Utility ───────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}


// ── CLI entry point ───────────────────────────────────────────

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const args = process.argv.slice(2);
  const flag = (name) => args.includes(`--${name}`);
  const opt   = (name, def) => {
    const arg = args.find(a => a.startsWith(`--${name}=`));
    return arg ? arg.split('=')[1] : def;
  };

  const options = {
    batchSize:   parseInt(opt('batch-size', '50'), 10),
    concurrency: parseInt(opt('concurrency', '6'), 10),
    category:    opt('category', null),
    force:       flag('force'),
    continuous:  flag('continuous'),
    runLabel:    opt('label', null),
  };

  console.log('\n🚀 S6 Enrichment Pipeline');
  console.log(`   batch-size:  ${options.batchSize}`);
  console.log(`   concurrency: ${options.concurrency}`);
  console.log(`   category:    ${options.category || 'all'}`);
  console.log(`   continuous:  ${options.continuous}`);
  console.log(`   force:       ${options.force}`);

  runEnrichmentBatch(options)
    .then(() => process.exit(0))
    .catch(err => {
      console.error('\nPipeline failed:', err.message);
      process.exit(1);
    });
}