import { NextResponse } from 'next/server';
import { getStore } from '@netlify/blobs';

const BLOB_STORE = 'catalog';
const RECORDS_KEY = 'records';
const META_KEY = 'enrichment-meta';
const SAMPLES_KEY = 'enrichment-samples';
// Rolling buffer of recent samples retained for UI spot-checking. Picked
// to be small enough that sample fetches are cheap, but big enough to give
// a representative cross-section of the catalog.
const MAX_SAMPLES = 20;

// Default batch sizing — tuned for Netlify's 10s free / 26s pro function timeout.
// Each image takes ~2-5s end-to-end (fetch + Claude vision). At concurrency=6,
// a batch of 20 runs ~3-4 waves which fits comfortably under 26s. The client
// can override these via POST body for faster/safer batching.
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_CONCURRENCY = 6;

// Tag vocabularies — kept aligned with SUBJECT_TAGS in recommend/route.js so
// vision tags are directly comparable to the regex-derived ones.
const SUBJECT_VOCAB = ['music', 'coastal', 'floral', 'landscape', 'urban', 'animal', 'southern', 'typography', 'abstract', 'food-drink', 'monochrome'];
const STYLE_VOCAB = ['modern', 'vintage', 'retro', 'abstract', 'photography', 'coastal', 'dramatic', 'music', 'urban', 'bohemian', 'minimalist', 'rustic', 'floral', 'landscape', 'illustration', 'line-art', 'watercolor', 'pop-art', 'mid-century', 'art-deco', 'food-drink', 'monochrome', 'whimsical', 'elegant', 'graphic', 'hand-drawn', 'ink', 'sketch', 'folk-art', 'tropical', 'celestial', 'anatomical', 'architectural', 'light'];
const PALETTE_VOCAB = ['black', 'white', 'bw', 'monochrome', 'blue', 'navy', 'teal', 'green', 'sage', 'red', 'burgundy', 'orange', 'terracotta', 'pink', 'purple', 'gold', 'metallic', 'neutral', 'warm', 'cool', 'earthy', 'muted', 'pastel', 'vibrant'];

// ——— GET: enrichment status —————————————————————————————————————————————————
// Returns progress metadata so the UI can render "X of Y enriched" without
// having to read the full records blob. Falls back gracefully if the meta
// blob doesn't exist yet (catalog uploaded but never enriched).
//
// Query params:
//   ?samples=true — also include the rolling sample buffer for UI
//                   spot-checking. Skipped by default to keep status polls
//                   cheap during enrichment.
export async function GET(request) {
  try {
    const url = new URL(request.url);
    const includeSamples = url.searchParams.get('samples') === 'true';
    const store = getStore(BLOB_STORE);
    const meta = await store.get(META_KEY, { type: 'json' }).catch(() => null);

    if (meta) {
      const response = { ...meta };
      if (includeSamples) {
        const samples = await store.get(SAMPLES_KEY, { type: 'json' }).catch(() => null);
        response.samples = Array.isArray(samples) ? samples : [];
      }
      return NextResponse.json(response);
    }

    // No meta yet — derive what we can from the records blob so the UI
    // can show "0 of N enriched" instead of an empty state.
    const raw = await store.get(RECORDS_KEY, { type: 'text' });
    if (!raw) {
      return NextResponse.json({
        totalRecords: 0,
        enrichedCount: 0,
        status: 'no-catalog',
      });
    }
    const records = JSON.parse(raw);
    const enrichedCount = records.filter(r => Array.isArray(r.visionStyle) && r.visionStyle.length > 0).length;
    return NextResponse.json({
      totalRecords: records.length,
      enrichedCount,
      lastProcessedIndex: 0,
      status: enrichedCount === 0 ? 'idle' : 'partial',
    });
  } catch (err) {
    console.error('Enrich GET error:', err);
    return NextResponse.json({ error: err.message || 'Failed to read enrichment status' }, { status: 500 });
  }
}

// ——— POST: process a batch ——————————————————————————————————————————————————
// Body: { batchSize?, concurrency?, resumeFrom?, force? }
//   batchSize: how many records to process this call (default 20)
//   concurrency: how many vision calls to run in parallel (default 6)
//   resumeFrom: starting index in the records array (default = meta.lastProcessedIndex)
//   force: if true, re-enrich records that already have visionStyle
//
// Skips records lacking image_url. Records that fail vision analysis get
// `visionError` set so we can identify and retry them later without blocking
// the batch.
export async function POST(request) {
  const startedAt = Date.now();
  try {
    const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;
    if (!hasAnthropicKey) {
      return NextResponse.json(
        { error: 'ANTHROPIC_API_KEY not configured — vision enrichment requires Claude API access.' },
        { status: 400 }
      );
    }

    let body = {};
    try { body = await request.json(); } catch {}
    const batchSize = clampInt(body.batchSize, DEFAULT_BATCH_SIZE, 1, 100);
    const concurrency = clampInt(body.concurrency, DEFAULT_CONCURRENCY, 1, 12);
    const force = !!body.force;

    const store = getStore(BLOB_STORE);
    const raw = await store.get(RECORDS_KEY, { type: 'text' });
    if (!raw) {
      return NextResponse.json({ error: 'No catalog loaded.' }, { status: 400 });
    }

    const records = JSON.parse(raw);
    if (!Array.isArray(records) || records.length === 0) {
      return NextResponse.json({ error: 'Catalog is empty.' }, { status: 400 });
    }

    const prevMeta = (await store.get(META_KEY, { type: 'json' }).catch(() => null)) || null;
    const resumeFrom = clampInt(
      body.resumeFrom,
      prevMeta?.lastProcessedIndex ?? 0,
      0,
      records.length
    );

    // Walk forward from resumeFrom, picking up records that need enrichment
    // until we hit batchSize. We track scanned (how far we walked) so the
    // client can resume from there even when most records are skipped (e.g.,
    // a re-run after a partial enrichment).
    const toProcess = [];
    let scanIndex = resumeFrom;
    while (scanIndex < records.length && toProcess.length < batchSize) {
      const r = records[scanIndex];
      const alreadyEnriched = Array.isArray(r.visionStyle) && r.visionStyle.length > 0;
      const hasImage = !!r.image_url;
      if (hasImage && (force || !alreadyEnriched)) {
        toProcess.push({ index: scanIndex, record: r });
      }
      scanIndex++;
    }

    if (toProcess.length === 0) {
      // Nothing left to enrich in this slice — either fully done or this
      // tail of the catalog has no images.
      const enrichedCount = records.filter(r => Array.isArray(r.visionStyle) && r.visionStyle.length > 0).length;
      const done = scanIndex >= records.length;
      const newMeta = {
        totalRecords: records.length,
        enrichedCount,
        lastProcessedIndex: done ? records.length : scanIndex,
        status: done ? (enrichedCount === records.length ? 'completed' : 'completed-with-skipped') : 'partial',
        startedAt: prevMeta?.startedAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        errorCount: prevMeta?.errorCount || 0,
      };
      await store.set(META_KEY, JSON.stringify(newMeta));
      return NextResponse.json({ ...newMeta, processed: 0, errors: [] });
    }

    // —— Run vision analysis with bounded concurrency ——————————————————————
    const results = await runWithConcurrency(toProcess, concurrency, async ({ index, record }) => {
      try {
        const analysis = await analyzeRecord(record);
        return { index, ok: true, analysis };
      } catch (e) {
        return { index, ok: false, error: e.message || 'unknown error' };
      }
    });

    // —— Apply analyses back into the records array ——————————————————————
    const errors = [];
    let succeeded = 0;
    for (const res of results) {
      const r = records[res.index];
      if (res.ok && res.analysis) {
        Object.assign(r, res.analysis, {
          visionAt: new Date().toISOString(),
          visionError: undefined,
        });
        // Object.assign won't actually delete a key by setting it to undefined
        // when serialized to JSON it'll be omitted, but we also want to clear
        // any prior error explicitly:
        delete r.visionError;
        succeeded++;
      } else {
        r.visionError = res.error || 'analysis failed';
        r.visionAt = new Date().toISOString();
        errors.push({ index: res.index, handle: r.product_handle, error: res.error });
      }
    }

    // —— Sample logging for spot-checking quality ————————————————————————
    // Pick one random successful analysis from this batch and add it to the
    // rolling sample buffer. Console-log it too so users tailing Netlify
    // function logs can eyeball tag quality in real time. We sample 1/batch
    // (rather than all) to keep the sample distribution representative across
    // the catalog instead of clustered around contiguous index ranges.
    const successful = results.filter(r => r.ok && r.analysis);
    let latestSamples = null;
    if (successful.length > 0) {
      const pick = successful[Math.floor(Math.random() * successful.length)];
      const r = records[pick.index];
      const sample = {
        index: pick.index,
        title: r.title || '',
        product_url: r.product_url || '',
        product_handle: r.product_handle || '',
        image_url: r.image_url || '',
        visionStyle: r.visionStyle || [],
        visionPalette: r.visionPalette || [],
        visionSubject: r.visionSubject || [],
        visionMood: r.visionMood || [],
        visionKeywords: r.visionKeywords || [],
        visionSummary: r.visionSummary || '',
        enrichedAt: r.visionAt,
      };
      console.log(
        `[enrich:sample] "${sample.title}" | subject=[${sample.visionSubject.join(',')}] | style=[${sample.visionStyle.slice(0, 4).join(',')}] | palette=[${sample.visionPalette.slice(0, 4).join(',')}] | "${sample.visionSummary}"`
      );

      // Read existing samples, prepend the new one, cap at MAX_SAMPLES.
      // Failures here shouldn't break the batch — samples are nice-to-have.
      try {
        const existing = await store.get(SAMPLES_KEY, { type: 'json' }).catch(() => null);
        const buffer = Array.isArray(existing) ? existing : [];
        latestSamples = [sample, ...buffer.filter(s => s.index !== sample.index)].slice(0, MAX_SAMPLES);
        await store.set(SAMPLES_KEY, JSON.stringify(latestSamples));
      } catch (e) {
        console.warn('[enrich:sample] failed to persist sample buffer:', e.message);
      }
    }

    // —— Persist updated catalog + meta ———————————————————————————————————
    await store.set(RECORDS_KEY, JSON.stringify(records));

    const enrichedCount = records.filter(r => Array.isArray(r.visionStyle) && r.visionStyle.length > 0).length;
    const done = scanIndex >= records.length;
    const newMeta = {
      totalRecords: records.length,
      enrichedCount,
      lastProcessedIndex: done ? records.length : scanIndex,
      status: done
        ? (enrichedCount === records.length ? 'completed' : 'completed-with-skipped')
        : 'partial',
      startedAt: prevMeta?.startedAt || new Date(startedAt).toISOString(),
      updatedAt: new Date().toISOString(),
      errorCount: (prevMeta?.errorCount || 0) + errors.length,
      lastBatchMs: Date.now() - startedAt,
    };
    await store.set(META_KEY, JSON.stringify(newMeta));

    console.log(`[enrich] processed ${succeeded}/${toProcess.length} (errors=${errors.length}) | total enriched ${enrichedCount}/${records.length} | ${newMeta.lastBatchMs}ms`);

    return NextResponse.json({
      ...newMeta,
      processed: succeeded,
      attempted: toProcess.length,
      errors,
      // Return the rolling sample buffer so the client can refresh its
      // spot-check panel without an extra round-trip per batch.
      samples: latestSamples || undefined,
    });
  } catch (err) {
    console.error('Enrich POST error:', err);
    return NextResponse.json(
      { error: err.message || 'Enrichment batch failed' },
      { status: 500 }
    );
  }
}

// ——— Helpers ————————————————————————————————————————————————————————————————

function clampInt(v, dflt, min, max) {
  const n = typeof v === 'number' ? v : parseInt(v, 10);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

// Bounded-concurrency map. Drains items through `worker` while keeping at
// most `limit` requests in flight. Preserves input order in the output.
async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function pump() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, pump));
  return results;
}

// Fetch image as base64 with timeout + retries on transient failures.
async function fetchImageAsBase64(imageUrl) {
  const fullUrl = imageUrl.startsWith('/') ? 'https://society6.com' + imageUrl : imageUrl;
  // Force a small width — Claude doesn't need high-res to identify style/subject
  // and small images keep token costs down. Idempotent if width is already set.
  const sized = ensureSmallWidth(fullUrl);

  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(sized, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; S6TradeCurationBot/1.0)',
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
      // Brief backoff before retry — covers transient network blips, not
      // upstream 4xx (which we'll fail fast on the second attempt anyway).
      if (attempt === 0) await new Promise(r => setTimeout(r, 250));
    }
  }
  throw lastErr || new Error('image fetch failed');
}

function ensureSmallWidth(url) {
  try {
    const u = new URL(url);
    // Cap width at 400 — Claude vision works fine at this resolution and
    // larger images burn through tokens unnecessarily.
    const existing = u.searchParams.get('width');
    if (!existing || parseInt(existing, 10) > 400) {
      u.searchParams.set('width', '400');
    }
    return u.toString();
  } catch {
    return url;
  }
}

// Run a Claude vision call against a single image and parse the structured
// response. Includes a single retry on 429 rate-limit errors with backoff.
async function analyzeRecord(record) {
  if (!record.image_url) throw new Error('no image_url on record');

  const { base64, mediaType } = await fetchImageAsBase64(record.image_url);

  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const prompt = `You are an expert art curator analyzing a single artwork image from Society6. Look carefully at the image and tag it for a recommendation system.

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

  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const message = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
            { type: 'text', text: prompt },
          ],
        }],
      });

      let raw = message.content[0].text.trim();
      raw = raw.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '');
      const parsed = JSON.parse(raw);

      return normalizeAnalysis(parsed);
    } catch (e) {
      lastErr = e;
      // Retry once on rate limit / overload with exponential backoff
      const msg = (e?.message || '').toLowerCase();
      const status = e?.status || e?.response?.status;
      if (status === 429 || status === 529 || msg.includes('rate') || msg.includes('overload')) {
        if (attempt === 0) {
          await new Promise(r => setTimeout(r, 1500));
          continue;
        }
      }
      throw e;
    }
  }
  throw lastErr || new Error('vision analysis failed');
}

// Coerce Claude's response into the shape we store. Lowercases tags, filters
// to known vocabularies where it matters (subjects), and ensures arrays.
function normalizeAnalysis(parsed) {
  const lower = (a) => (Array.isArray(a) ? a : []).map(s => String(s).toLowerCase().trim()).filter(Boolean);
  return {
    visionStyle: lower(parsed.visionStyle),
    visionPalette: lower(parsed.visionPalette),
    // Subject tags are used for the -15 mismatch penalty in scoreRecord, so
    // we MUST clamp them to the known SUBJECT_VOCAB. Anything outside it
    // would silently break the penalty logic.
    visionSubject: lower(parsed.visionSubject).filter(s => SUBJECT_VOCAB.includes(s)),
    visionMood: lower(parsed.visionMood),
    visionKeywords: lower(parsed.visionKeywords),
    visionSummary: typeof parsed.visionSummary === 'string' ? parsed.visionSummary.slice(0, 280) : '',
  };
}
