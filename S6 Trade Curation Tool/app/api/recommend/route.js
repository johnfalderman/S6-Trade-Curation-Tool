import { NextResponse } from 'next/server';
import pg from 'pg';

// ———————————————————————————————————————————————————————————————————————————
// Trade Curation Tool — recommendation engine (Neon-backed, per-design catalog)
//
// Three stages:
//   1. Claude parses the prose brief into catalog-aligned tags (hard/soft avoid)
//   2. Weighted tag-overlap scoring runs IN Postgres over enriched_products,
//      with color-family hard-avoid exclusion + per-artist pool cap
//   3. Claude curator picks the final set, then a per-artist final cap is applied
//
// Catalog is ONE ROW PER DESIGN (64,281). Format (poster/framed/etc.) is a
// downstream presentation concern, not part of matching — so the same artwork
// can never appear twice in a result, and there are no per-format filters here.
// ———————————————————————————————————————————————————————————————————————————

// ——— Scoring weights ————————————————————————————————————————————————————————
const W_STYLE   = 3;
const W_PALETTE = 2;
const W_MOOD    = 1;
const W_KEYWORD = 4;
const W_SUBJECT = 8;
const W_AVOID_SOFT = 8;

const POOL_CAP   = 3;    // max designs per artist in the candidate pool
const POOL_LIMIT = 200;  // candidates handed to Claude
const FINAL_CAP  = 2;    // max designs per artist in the final set
const FINAL_N    = 20;

const PARSE_MODEL  = 'claude-haiku-4-5-20251001';
const SELECT_MODEL = 'claude-haiku-4-5-20251001';

// ——— Connection pool (module-scoped so it's reused across warm invocations) —
let _pool = null;
function getPool() {
  if (!_pool) {
    _pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 3,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
    // Don't let a pooled-connection socket death crash the function.
    _pool.on('error', (err) => console.warn('[pg pool] idle client error:', err.message));
  }
  return _pool;
}

// ——— Color families for hard-avoid expansion ————————————————————————————————
// A banned base color expands to its whole family, matched by substring against
// the design's palette tags. tan/sand/beige/taupe are deliberately excluded
// from the brown family (coastal-adjacent); only banned if named explicitly.
const COLOR_FAMILIES = {
  orange: ['orange', 'terracotta', 'burnt orange', 'coral orange', 'amber', 'rust', 'tangerine', 'apricot'],
  brown:  ['brown', 'warm brown', 'rust-brown', 'pale brown', 'chocolate', 'mahogany', 'sienna', 'umber', 'coffee'],
  red:    ['red', 'crimson', 'scarlet', 'burgundy', 'maroon', 'brick red'],
  pink:   ['pink', 'blush', 'rose', 'magenta', 'fuchsia', 'dusty rose'],
  purple: ['purple', 'violet', 'lavender', 'plum', 'mauve', 'lilac'],
  green:  ['green', 'sage green', 'forest green', 'olive', 'emerald', 'mint', 'seafoam'],
  blue:   ['blue', 'navy', 'navy blue', 'teal', 'turquoise', 'cobalt', 'indigo', 'aqua', 'cyan'],
  yellow: ['yellow', 'golden yellow', 'mustard', 'gold', 'ochre'],
  gray:   ['gray', 'grey', 'charcoal', 'slate'],
  black:  ['black', 'onyx', 'ebony'],
};

const PALETTE_COLOR_WORDS = new Set([
  'cream','white','black','orange','gold','pink','yellow','teal','red','tan',
  'green','sage green','blue','coral','gray','grey','brown','beige','golden yellow',
  'charcoal','navy','navy blue','forest green','purple','turquoise','terracotta',
  'rust','amber','burgundy','maroon','peach','mint','seafoam','aqua','indigo',
  'cobalt','lavender','blush','sand','sandy','olive','mustard','ochre','sienna'
]);

function expandColor(term) {
  const t = (term || '').toLowerCase().trim();
  if (COLOR_FAMILIES[t]) return COLOR_FAMILIES[t];
  for (const [, members] of Object.entries(COLOR_FAMILIES)) {
    if (members.includes(t)) return members;
  }
  return [t];
}

function splitAvoid(hardAvoid) {
  const colorSubstrings = new Set();
  const nonColors = [];
  for (const t of hardAvoid) {
    const isColor = PALETTE_COLOR_WORDS.has(t) || COLOR_FAMILIES[t] ||
      Object.values(COLOR_FAMILIES).some(m => m.includes(t));
    if (isColor) {
      for (const member of expandColor(t)) colorSubstrings.add(member);
    } else {
      nonColors.push(t);
    }
  }
  return { colorSubstrings: Array.from(colorSubstrings), nonColors };
}

// ——— Catalog head vocabulary (fed to the parser so brief & data align) ———————
const CATALOG_STYLES = 'illustration, minimalist, line art, geometric, photographic, abstract, vintage, mid-century modern, geometric abstraction, watercolor, typography, watercolor illustration, minimalist illustration, vintage illustration, retro';
const CATALOG_PALETTE = 'cream, white, black, orange, gold, pink, yellow, teal, red, tan, green, sage green, blue, coral, gray, brown, beige, golden yellow, charcoal, navy, forest green, purple, turquoise, terracotta, navy blue';
const CATALOG_MOODS = 'contemplative, playful, serene, calm, whimsical, peaceful, warm, nostalgic, energetic, meditative, cheerful, joyful, retro, balanced, bold';

const lc = (arr) => Array.from(new Set((arr || []).map(s => (s || '').toLowerCase().trim()).filter(Boolean)));
const FENCE_OPEN = new RegExp('^```json?\\s*', 'i');
const FENCE_CLOSE = new RegExp('\\s*```$', 'i');
const stripFences = (s) => s.trim().replace(FENCE_OPEN, '').replace(FENCE_CLOSE, '');

// ——— Stage 1: parse the brief ———————————————————————————————————————————————
async function parseBriefWithClaude(text) {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const msg = await client.messages.create({
    model: PARSE_MODEL,
    max_tokens: 1024,
    messages: [{ role: 'user', content:
`You parse interior-design art curation briefs into structured tags for a catalog search.
The catalog tags artwork with a known vocabulary — ALIGN your output to it so matching works.

CATALOG STYLE TAGS (use these spellings where they fit): ${CATALOG_STYLES}
CATALOG PALETTE TAGS (use these exact color words): ${CATALOG_PALETTE}
CATALOG MOOD TAGS: ${CATALOG_MOODS}

BRIEF:
${text}

CRITICAL — distinguish two kinds of negative:
- avoidHard = things the client EXPLICITLY BANS. Language like "no orange", "NO browns or oranges at all", "nothing western", "absolutely no florals". These will HARD-EXCLUDE matching artwork from results.
- avoidSoft = mere preferences or de-emphasis. Language like "not too rustic", "prefer blues", "lean modern", "less busy". These only push artwork DOWN, not out.
When unsure, put it in avoidSoft (soft is safer — a hard ban removes art entirely). Only use avoidHard when the brief's language is an explicit prohibition.
For banned colors, just name the base color (e.g. "brown", "orange") — the system expands to related shades automatically.

Return ONLY valid JSON, no markdown:
{
  "projectName": "look for 'Design Project','Project Name' etc., else empty string",
  "clientName": "look for 'Company','Client','Property Name' etc., else empty string",
  "location": "city/state if present, else empty string",
  "projectType": "hotel|restaurant|vacation_rental|office|residential|other",
  "briefSummary": "2-3 sentences",
  "styleTags": ["catalog style words that fit"],
  "paletteTags": ["catalog COLOR words the client wants — use exact catalog spellings"],
  "moodTags": ["catalog mood words that fit the space"],
  "subjectTokens": ["3-8 concrete SINGLE-WORD subject words the art should depict — e.g. ocean, dune, sailboat, palm, wildflower, marsh. Prefer single words over phrases."],
  "keywords": ["12-20 specific words likely to appear in matching artwork descriptions"],
  "avoidHard": ["explicitly BANNED colors/subjects/styles. For colors, name the base color only. Empty array if nothing is explicitly banned."],
  "avoidSoft": ["de-emphasized preferences — pushed down, not excluded"],
  "galleryWall": true or false,
  "keyThemes": ["3-6 short vibe phrases"]
}`
    }]
  });
  return JSON.parse(stripFences(msg.content[0].text));
}

// ——— Regex fallback parser (no API key) —————————————————————————————————————
function parseBriefFallback(text) {
  const t = (text || '').toLowerCase();
  const has = (re) => re.test(t);
  const styleTags = [];
  if (has(/minimal/)) styleTags.push('minimalist');
  if (has(/line art|line drawing/)) styleTags.push('line art');
  if (has(/geometric/)) styleTags.push('geometric');
  if (has(/abstract/)) styleTags.push('abstract');
  if (has(/watercolor|watercolour/)) styleTags.push('watercolor');
  if (has(/mid.?century/)) styleTags.push('mid-century modern');
  if (has(/vintage|retro/)) styleTags.push('vintage');
  const paletteTags = [];
  for (const c of ['blue','navy','teal','turquoise','sage green','cream','white','pink','green','gold','gray','black']) {
    if (t.includes(c)) paletteTags.push(c);
  }
  return {
    projectName: '', clientName: '', location: '', projectType: 'other',
    briefSummary: `Project seeking ${styleTags.join(', ') || 'wall'} art in ${paletteTags.join(', ') || 'mixed'} tones.`,
    styleTags, paletteTags, moodTags: [],
    subjectTokens: [], keywords: [...styleTags, ...paletteTags],
    avoidHard: [], avoidSoft: [], galleryWall: t.includes('gallery wall'),
    keyThemes: styleTags.slice(0, 3),
  };
}

// ——— Stage 2: weighted scoring in Postgres ————————————————————————————————
async function scorePool(brief) {
  const hard = splitAvoid(lc(brief.avoidHard));
  const params = [
    lc(brief.styleTags),     // $1
    lc(brief.paletteTags),   // $2
    lc(brief.moodTags),      // $3
    lc(brief.keywords),      // $4
    lc(brief.subjectTokens), // $5
    lc(brief.avoidSoft),     // $6
    POOL_CAP,                // $7
    POOL_LIMIT,              // $8
    hard.colorSubstrings,    // $9
    hard.nonColors,          // $10
  ];

  const sql = `
  WITH base AS (
    SELECT
      p.id, p.s6_product_id, p.title, p.artist_name, p.artist_handle,
      p.product_type, p.image_url, p.product_url,
      e.vision_subject, e.vision_style, e.vision_palette, e.vision_mood,
      lower(concat_ws(' ', e.vision_summary, e.vision_subject, e.vision_style,
        e.vision_palette, e.vision_mood, e.vision_keywords, e.artwork_description)) AS blob,
      regexp_split_to_array(lower(coalesce(e.vision_style,'')),   '\\s*,\\s*') AS style_tags,
      regexp_split_to_array(lower(coalesce(e.vision_palette,'')), '\\s*,\\s*') AS palette_tags,
      regexp_split_to_array(lower(coalesce(e.vision_mood,'')),    '\\s*,\\s*') AS mood_tags
    FROM products p
    JOIN enrichment_results e ON e.product_id = p.id AND e.is_current = true
    WHERE p.description_status = 'described'
  ),
  filtered AS (
    SELECT * FROM base
    WHERE
      NOT EXISTS (
        SELECT 1 FROM unnest($9::text[]) c, unnest(palette_tags) pt
        WHERE c <> '' AND pt LIKE '%'||c||'%'
      )
      AND NOT EXISTS (
        SELECT 1 FROM unnest($10::text[]) n
        WHERE n <> '' AND (palette_tags @> ARRAY[n] OR blob LIKE '%'||n||'%')
      )
  ),
  scored AS (
    SELECT *,
      ${W_STYLE}   * cardinality(ARRAY(SELECT unnest(style_tags)   INTERSECT SELECT unnest($1::text[]))) +
      ${W_PALETTE} * cardinality(ARRAY(SELECT unnest(palette_tags) INTERSECT SELECT unnest($2::text[]))) +
      ${W_MOOD}    * cardinality(ARRAY(SELECT unnest(mood_tags)    INTERSECT SELECT unnest($3::text[]))) +
      ${W_KEYWORD} * (SELECT count(*) FROM unnest($4::text[]) k WHERE k <> '' AND blob LIKE '%'||k||'%') +
      ${W_SUBJECT} * (SELECT count(*) FROM unnest($5::text[]) s WHERE s <> '' AND (lower(vision_subject) LIKE '%'||s||'%' OR blob LIKE '%'||s||'%')) -
      ${W_AVOID_SOFT} * (SELECT count(*) FROM unnest($6::text[]) a WHERE a <> '' AND (palette_tags @> ARRAY[a] OR blob LIKE '%'||a||'%'))
      AS score
    FROM filtered
  ),
  ranked AS (
    SELECT *, row_number() OVER (PARTITION BY artist_name ORDER BY score DESC, s6_product_id) AS artist_rn
    FROM scored
    WHERE score > 0
  )
  SELECT
    s6_product_id, title, artist_name, artist_handle, product_type,
    image_url, product_url, vision_subject, vision_style, vision_palette, vision_mood, score
  FROM ranked
  WHERE artist_rn <= $7
  ORDER BY score DESC, s6_product_id
  LIMIT $8
  `;

  const res = await getPool().query(sql, params);
  return res.rows;
}

// ——— Stage 3: Claude curator pick ———————————————————————————————————————————
async function selectWithClaude(candidates, brief) {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const list = candidates.slice(0, 150).map((r, i) =>
    `${i}|${r.title}|by ${r.artist_name}|subj:${r.vision_subject}|style:${r.vision_style}|palette:${r.vision_palette}`
  ).join('\n');
  const avoidAll = [...(brief.avoidHard||[]), ...(brief.avoidSoft||[])];
  const msg = await client.messages.create({
    model: SELECT_MODEL,
    max_tokens: 2500,
    messages: [{ role: 'user', content:
`You are an expert art curator for Society6's trade program, choosing wall art for a client.

CLIENT BRIEF:
${brief.briefSummary || ''}
Project: ${brief.projectName || 'Trade Client'} (${brief.projectType || 'commercial'})
Wants — style: ${(brief.styleTags||[]).join(', ')}; palette: ${(brief.paletteTags||[]).join(', ')}; subjects: ${(brief.subjectTokens||[]).join(', ')}
Avoid: ${avoidAll.join(', ') || 'nothing specified'}

CANDIDATES (index|title|artist|subject|style|palette):
${list}

Pick the ${FINAL_N} that form the most coherent curated set for this space. Favor breadth across artists.
Reject anything whose SUBJECT clashes with the brief even if colors match. Honor the avoid list strictly.

Return ONLY a JSON array, no markdown:
[{"index": 0, "reason": "one specific sentence on why it fits"}]`
    }]
  });
  return JSON.parse(stripFences(msg.content[0].text));
}

// Final per-artist cap, then backfill from the pool to reach FINAL_N
function applyFinalCap(picks, poolRows) {
  const perArtist = {};
  const chosen = [];
  const used = new Set();
  for (const p of picks) {
    const c = poolRows[p.index];
    if (!c) continue;
    const a = c.artist_name;
    if ((perArtist[a] || 0) >= FINAL_CAP) continue;
    perArtist[a] = (perArtist[a] || 0) + 1;
    chosen.push({ ...c, reason: p.reason });
    used.add(c.s6_product_id);
    if (chosen.length >= FINAL_N) break;
  }
  for (const c of poolRows) {
    if (chosen.length >= FINAL_N) break;
    if (used.has(c.s6_product_id)) continue;
    const a = c.artist_name;
    if ((perArtist[a] || 0) >= FINAL_CAP) continue;
    perArtist[a] = (perArtist[a] || 0) + 1;
    chosen.push({ ...c, reason: '' });
    used.add(c.s6_product_id);
  }
  return chosen;
}

// Pass-through normalizer — image_url and product_url are already full
// cdn.shopify.com / society6 URLs in the new catalog. Map to the shape the
// front end expects (it reads product_handle/source_collection historically;
// we alias them so page.jsx keeps working unchanged).
function toCard(r) {
  return {
    ...r,
    product_handle: r.s6_product_id,         // stable id alias
    source_collection: r.product_type || '', // legacy field name the UI reads
  };
}

// ——— Route handler ——————————————————————————————————————————————————————————
export async function POST(request) {
  try {
    let briefText = '';
    let pinnedUrls = [];
    let findSimilarUrls = [];

    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      briefText = formData.get('brief') || '';
      try { pinnedUrls = JSON.parse(formData.get('pinnedUrls') || '[]'); } catch {}
      try { findSimilarUrls = JSON.parse(formData.get('findSimilarUrls') || '[]'); } catch {}
    } else {
      const body = await request.json();
      briefText = body.brief || '';
      pinnedUrls = body.pinnedUrls || [];
      findSimilarUrls = body.findSimilarUrls || [];
    }

    if (!process.env.DATABASE_URL) {
      return NextResponse.json({ error: 'Catalog database not configured (DATABASE_URL missing).' }, { status: 500 });
    }

    const hasBriefText = !!(briefText || '').trim();
    const hasSeeds = (Array.isArray(findSimilarUrls) ? findSimilarUrls : []).length > 0;

    if (!hasBriefText && hasSeeds) {
      return NextResponse.json({
        error: 'Find Similar is being rebuilt against the new catalog and is temporarily unavailable. Please use a brief for now.',
      }, { status: 400 });
    }
    if (!hasBriefText) {
      return NextResponse.json({ error: 'Please provide a curation brief.' }, { status: 400 });
    }

    const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;

    // —— Stage 1 ——
    let brief;
    if (hasAnthropicKey) {
      try {
        brief = await parseBriefWithClaude(briefText);
        brief.parsedBy = 'claude';
      } catch (e) {
        console.warn('Claude brief parse failed, using fallback:', e.message);
        brief = parseBriefFallback(briefText);
        brief.parsedBy = 'regex-fallback';
      }
    } else {
      brief = parseBriefFallback(briefText);
      brief.parsedBy = 'regex';
    }

    // —— Stage 2 ——
    const candidates = (await scorePool(brief)).map(toCard);
    const totalScored = candidates.length;

    if (candidates.length === 0) {
      return NextResponse.json({
        brief, primary: [], accent: [], galleryWallSets: [],
        totalScored: 0, catalogSize: 64281, filteredSize: 64281,
        aiPowered: hasAnthropicKey,
        note: 'No designs scored above zero for this brief. Try loosening color or subject constraints.',
      });
    }

    // —— Stage 3 ——
    let primary = [];
    let accent = [];
    if (hasAnthropicKey) {
      try {
        const picks = await selectWithClaude(candidates, brief);
        primary = applyFinalCap(picks, candidates);
        const primarySet = new Set(primary.map(r => r.s6_product_id));
        accent = candidates.filter(r => !primarySet.has(r.s6_product_id)).slice(0, 15);
      } catch (e) {
        console.warn('Claude selection failed, using weighted order:', e.message);
        primary = candidates.slice(0, FINAL_N);
        accent = candidates.slice(FINAL_N, FINAL_N + 15);
      }
    } else {
      primary = candidates.slice(0, FINAL_N);
      accent = candidates.slice(FINAL_N, FINAL_N + 15);
    }

    // —— Pinned items (force-include by s6_product_id or matching product_url) ——
    if (Array.isArray(pinnedUrls) && pinnedUrls.length > 0) {
      const pinnedRows = [];
      for (const url of pinnedUrls) {
        const hit = candidates.find(c => c.product_url === url || (c.product_url || '').includes(url));
        if (hit) pinnedRows.push({ ...hit, pinned: true });
      }
      if (pinnedRows.length > 0) {
        const pinnedSet = new Set(pinnedRows.map(r => r.s6_product_id));
        primary = [...pinnedRows, ...primary.filter(r => !pinnedSet.has(r.s6_product_id))];
      }
    }

    // —— Gallery wall sets ——
    const galleryWallSets = brief.galleryWall ? [
      { setNumber: 1, theme: (brief.keyThemes || [])[0] || 'curated', items: primary.slice(0, 6) },
      { setNumber: 2, theme: (brief.keyThemes || [])[1] || 'accent',  items: primary.slice(6, 12) },
    ] : [];

    return NextResponse.json({
      brief,
      primary: primary.slice(0, FINAL_N),
      accent: accent.slice(0, 15),
      galleryWallSets,
      totalScored,
      catalogSize: 64281,
      filteredSize: totalScored,
      aiPowered: hasAnthropicKey,
    });
  } catch (err) {
    console.error('Recommend error:', err);
    return NextResponse.json({ error: err.message || 'Failed to generate recommendations' }, { status: 500 });
  }
}
