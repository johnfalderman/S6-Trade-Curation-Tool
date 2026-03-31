import { NextResponse } from 'next/server';
import { getStore } from '@netlify/blobs';

// ─── LLM Brief Parser ─────────────────────────────────────────────────────────
// Uses Claude Haiku to extract structured data from free-form Jotform text.
// Falls back to regex parsing if ANTHROPIC_API_KEY is not set.

async function parseBriefWithClaude(text) {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: `You are an interior design trade art curation assistant. Parse this Jotform curation brief into structured JSON.

BRIEF TEXT:
${text}

Return ONLY valid JSON (no markdown, no explanation) with exactly these fields:
{
  "projectName": "string or empty",
  "projectType": "hotel|restaurant|vacation_rental|office|other",
  "styleTags": ["keywords describing the desired art style — e.g. music, jazz, vintage, modern, dramatic, urban, dark, bold, abstract, photography"],
  "paletteTags": ["color keywords — e.g. purple, dark, metallic, neutral, blue, black, warm, red"],
  "avoidTags": ["things to avoid — e.g. light, airy, bright, floral, pastel, kids, landscape, typography"],
  "galleryWall": true or false,
  "targetPieceCount": number or null,
  "keyThemes": ["2-5 short vibe or theme phrases extracted from the brief — e.g. 'jazz club', 'music posters', 'dark moody', 'old school art'"],
  "rooms": ["list of room types mentioned"]
}`
    }]
  });

  const jsonStr = message.content[0].text.trim();
  return JSON.parse(jsonStr);
}

// ─── Regex Brief Parser (fallback) ───────────────────────────────────────────

function parseBriefText(text) {
  if (!text) return defaultBrief();
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  const get = (label) => {
    const re = new RegExp(`^${label}\\s*[:\\-]\\s*(.+)`, 'i');
    for (const line of lines) {
      const m = line.match(re);
      if (m) return m[1].trim();
    }
    return '';
  };

  const projectName = get('Project Name') || get('Name');

  const projectTypeLine = (get('Project Type') || get('Type')).toLowerCase();
  let projectType = 'other';
  if (/restaurant|dining|cafe|bar/.test(projectTypeLine)) projectType = 'restaurant';
  else if (/hotel|hospitality|resort/.test(projectTypeLine)) projectType = 'hotel';
  else if (/vacation rental|vrbo|airbnb|short.?term/.test(projectTypeLine)) projectType = 'vacation_rental';
  else if (/office|corporate|workspace/.test(projectTypeLine)) projectType = 'office';

  const pieceField = get('Target Pieces') || get('Pieces') || get('Target');
  let pieceCount = 10;
  if (pieceField) {
    const num = pieceField.match(/(\d+)/);
    if (num) pieceCount = parseInt(num[1]);
  } else {
    const inBody = text.match(/(\d+)\s*(piece|print|artwork)/i);
    if (inBody) pieceCount = parseInt(inBody[1]);
  }

  const roomsField = get('Rooms') || get('Spaces');
  const rooms = roomsField ? roomsField.split(/,|;/).map(r => r.trim()).filter(Boolean) : [];
  const galleryField = (get('Gallery Wall') || get('Gallery')).toLowerCase();
  const galleryWall = galleryField.includes('yes') || text.toLowerCase().includes('gallery wall: yes');
  const styleField = (get('Design Style') || get('Style') || '').toLowerCase();
  const fullLower = text.toLowerCase();

  const styleMap = {
    modern:       ['modern', 'contemporary', 'minimal', 'minimalist', 'clean'],
    vintage:      ['vintage', 'retro', 'antique', 'classic', 'old school'],
    coastal:      ['coastal', 'beach', 'ocean', 'nautical', 'seaside'],
    southern:     ['southern', 'rustic', 'farmhouse', 'country', 'western', 'boho', 'bohemian'],
    abstract:     ['abstract', 'expressionist', 'geometric', 'non-representational'],
    photography:  ['photo', 'photograph', 'photography', 'realistic'],
    illustration: ['illustration', 'illustrated', 'drawing', 'sketch'],
    dramatic:     ['dramatic', 'bold', 'statement', 'impactful', 'striking', 'moody', 'dark'],
    music:        ['music', 'jazz', 'blues', 'rock', 'band', 'concert', 'vinyl', 'instrument', 'guitar', 'piano', 'trumpet', 'saxophone', 'melody', 'record', 'song', 'rhythm', 'acoustic', 'musician', 'album', 'lyric', 'harmony', 'music poster'],
    urban:        ['urban', 'city', 'street', 'industrial', 'metropolitan', 'downtown'],
  };
  const styleTags = [];
  for (const [tag, kws] of Object.entries(styleMap)) {
    if (kws.some(kw => styleField.includes(kw) || fullLower.includes(kw))) styleTags.push(tag);
  }

  const paletteField = (get('Color Palette') || get('Palette') || get('Colors') || '').toLowerCase();
  const paletteMap = {
    purple:   ['purple', 'violet', 'lavender', 'plum', 'mauve', 'amethyst'],
    neutral:  ['neutral', 'beige', 'tan', 'cream', 'ivory', 'white', 'warm white', 'off-white'],
    blue:     ['blue', 'navy', 'teal', 'cobalt', 'indigo', 'cerulean'],
    green:    ['green', 'sage', 'olive', 'forest', 'emerald', 'mint'],
    orange:   ['orange', 'terracotta', 'rust', 'burnt orange', 'amber', 'copper'],
    pink:     ['pink', 'blush', 'rose', 'coral', 'magenta'],
    black:    ['black', 'dark', 'charcoal', 'ebony', 'onyx', 'deep'],
    metallic: ['gold', 'silver', 'metallic', 'brass', 'bronze', 'chrome'],
    warm:     ['warm', 'earthy', 'earth tone'],
    red:      ['red', 'crimson', 'burgundy', 'wine', 'maroon'],
  };
  const paletteTags = [];
  for (const [tag, kws] of Object.entries(paletteMap)) {
    if (kws.some(kw => paletteField.includes(kw) || fullLower.includes(kw))) paletteTags.push(tag);
  }

  const avoidRaw = (
    get('Avoid') || get('Anything we should avoid') ||
    get('What to avoid') || get('Avoid during') || ''
  ).toLowerCase();
  const avoidMap = {
    light:       ['light', 'airy', 'pastel', 'soft', 'delicate', 'bright', 'white', 'light and airy'],
    floral:      ['floral', 'flowers', 'botanical', 'garden'],
    kids:        ['kids', 'children', 'nursery', 'playful', 'cartoon'],
    landscape:   ['landscape', 'nature', 'scenery'],
    typography:  ['typography', 'text', 'words', 'quotes', 'lettering'],
    abstract:    ['abstract', 'non-representational'],
    dark:        ['dark', 'dark imagery', 'moody', 'skulls'],
    animal:      ['animal', 'animals', 'wildlife'],
  };
  const avoidTags = [];
  for (const [tag, kws] of Object.entries(avoidMap)) {
    if (kws.some(kw => avoidRaw.includes(kw))) avoidTags.push(tag);
  }

  return { projectName, projectType, styleTags, paletteTags, avoidTags, galleryWall, pieceCount, rooms, keyThemes: styleTags };
}

function defaultBrief() {
  return { projectName: '', projectType: 'other', styleTags: [], paletteTags: [], avoidTags: [], galleryWall: false, pieceCount: 10, rooms: [], keyThemes: [] };
}

// ─── Catalog Tagging & Scoring ───────────────────────────────────────────────

function tagRecord(r) {
  const text = ((r.title || '') + ' ' + (r.image_alt || '') + ' ' + (r.source_collection || '') + ' ' + (r.product_handle || '')).toLowerCase();
  const style = [];
  const palette = [];

  if (/jazz|blues|rock|music|band|concert|vinyl|instrument|guitar|piano|trumpet|saxophone|drum|melody|music.?note|treble|clef|acoustic|musician|album|lyric|harmony|rhythm|song|record.?player|music.?poster/.test(text)) style.push('music');
  if (/abstract|geometric|expressionist/.test(text)) style.push('abstract');
  if (/photo|photograph/.test(text)) style.push('photography');
  if (/illustrat|drawing|sketch/.test(text)) style.push('illustration');
  if (/vintage|retro|antique/.test(text)) style.push('vintage');
  if (/modern|contemporary|minimal/.test(text)) style.push('modern');
  if (/coastal|beach|ocean|nautical/.test(text)) style.push('coastal');
  if (/floral|flower|botanical|garden|bloom/.test(text)) style.push('floral');
  if (/landscape|nature|mountain|forest|scenic/.test(text)) style.push('landscape');
  if (/typography|lettering|quote|word/.test(text)) style.push('typography');
  if (/city|urban|street|skyline|downtown/.test(text)) style.push('urban');
  if (/animal|cat|dog|bird|wildlife/.test(text)) style.push('animal');
  if (/dramatic|bold|dark|moody|noir/.test(text)) style.push('dramatic');
  if (/southern|rustic|farmhouse|country/.test(text)) style.push('southern');
  // "light and airy" signal — used for avoid filtering
  if (/watercolor|pastel|soft|airy|light|bright|spring|garden|floral|sunshine|delicate/.test(text)) style.push('light');

  if (/purple|violet|lavender|plum|amethyst/.test(text)) palette.push('purple');
  if (/blue|navy|teal|indigo|cobalt/.test(text)) palette.push('blue');
  if (/green|sage|olive|forest|emerald/.test(text)) palette.push('green');
  if (/black|dark|charcoal|ebony|noir/.test(text)) palette.push('black');
  if (/gold|silver|metallic|brass|bronze/.test(text)) palette.push('metallic');
  if (/red|crimson|burgundy|wine|maroon/.test(text)) palette.push('red');
  if (/orange|terracotta|rust|amber/.test(text)) palette.push('orange');
  if (/pink|blush|rose|coral/.test(text)) palette.push('pink');
  if (/neutral|beige|ivory|cream|tan/.test(text)) palette.push('neutral');
  if (/warm|earthy/.test(text)) palette.push('warm');

  return { ...r, style, palette };
}

function scoreRecord(r, brief) {
  let score = 0;
  const style = r.style || [];
  const palette = r.palette || [];
  const text = ((r.title || '') + ' ' + (r.image_alt || '')).toLowerCase();

  for (const s of brief.styleTags) {
    if (style.includes(s)) score += 3;
  }
  for (const p of brief.paletteTags) {
    if (palette.includes(p)) score += 2;
  }
  // Hard penalize avoid tags — strong negative signal
  for (const a of brief.avoidTags) {
    if (style.includes(a) || text.includes(a)) score -= 8;
  }
  // Always penalize "light" tagged items when client wants dark/dramatic
  if (style.includes('light') && (brief.paletteTags.includes('black') || brief.styleTags.includes('dramatic'))) {
    score -= 6;
  }

  if (r.source_collection) {
    if (r.source_collection.includes('art-print')) score += 1;
    if (r.source_collection.includes('canvas')) score += 1;
    if (r.source_collection.includes('best-selling')) score += 1;
  }

  return score;
}

function normalize(r) {
  const base = 'https://society6.com';
  return {
    ...r,
    product_url: r.product_url
      ? (r.product_url.startsWith('http') ? r.product_url : base + r.product_url)
      : '',
    image_url: r.image_url
      ? (r.image_url.startsWith('http') ? r.image_url : base + r.image_url)
      : '',
  };
}

// ─── LLM Re-ranker ────────────────────────────────────────────────────────────
// Sends top keyword-matched candidates to Claude for semantic re-ranking.
// Returns the best matches in order, filtered against avoid criteria.

async function rerankWithClaude(brief, candidates) {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const pool = candidates.slice(0, 60);
  const itemList = pool.map((item, i) =>
    `${i}: "${item.title}"${item.image_alt ? ' — ' + item.image_alt : ''} [${item.source_collection || ''}]`
  ).join('\n');

  const themes = (brief.keyThemes || brief.styleTags || []).join(', ');
  const palette = (brief.paletteTags || []).join(', ');
  const avoid = (brief.avoidTags || []).join(', ');

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    messages: [{
      role: 'user',
      content: `You are a professional interior design art curator for a Society6 trade account.

PROJECT BRIEF:
- Vibe / themes: ${themes || 'not specified'}
- Color palette: ${palette || 'not specified'}
- Project type: ${brief.projectType || 'other'}
- Avoid: ${avoid || 'nothing specified'}

CANDIDATE ARTWORKS (index: title — description [collection]):
${itemList}

Select the 20 best matches for this brief. Hard-exclude anything that clearly matches the avoid criteria (e.g. if avoiding "light and airy", skip watercolors, pastels, soft florals).

Return ONLY a JSON array of up to 20 item indices, best first. Example: [3, 12, 0, 7]`
    }]
  });

  try {
    const raw = message.content[0].text.trim();
    // Extract JSON array even if there's surrounding text
    const match = raw.match(/\[[\d,\s]+\]/);
    const indices = JSON.parse(match ? match[0] : raw);
    return indices.map(i => pool[i]).filter(Boolean);
  } catch (e) {
    console.warn('Re-rank parse failed, using keyword order:', e.message);
    return candidates.slice(0, 20);
  }
}

// ─── PDF Text Extraction ─────────────────────────────────────────────────────

async function extractPdfKeywords(fileBuffer) {
  try {
    const pdfParse = (await import('pdf-parse')).default;
    const data = await pdfParse(fileBuffer);
    return data.text || '';
  } catch (e) {
    console.warn('PDF parse failed (likely image-based moodboard):', e.message);
    return '';
  }
}

// ─── Route Handler ───────────────────────────────────────────────────────────

export async function POST(request) {
  try {
    let briefText = '';
    let moodboardUrl = '';
    let pdfKeywords = '';
    let hasMoodboard = false;

    const contentType = request.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      briefText = formData.get('brief') || '';
      moodboardUrl = formData.get('moodboardUrl') || '';
      const file = formData.get('moodboard');
      if (file && file.size > 0) {
        hasMoodboard = true;
        const buffer = Buffer.from(await file.arrayBuffer());
        pdfKeywords = await extractPdfKeywords(buffer);
      }
    } else {
      const body = await request.json();
      briefText = body.brief || '';
      moodboardUrl = body.moodboardUrl || '';
    }

    // ── Parse brief ──────────────────────────────────────────────────────────
    let brief;
    const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;

    if (hasAnthropicKey) {
      try {
        // Merge PDF keywords into brief text if available
        const fullText = pdfKeywords ? `${briefText}\n\n--- MOODBOARD NOTES ---\n${pdfKeywords}` : briefText;
        brief = await parseBriefWithClaude(fullText);
        brief.parsedBy = 'claude';
        if (pdfKeywords) brief.moodboardNote = 'Moodboard text extracted and incorporated into recommendations.';
        else if (hasMoodboard) brief.moodboardNote = 'Image-based moodboard received. For best results, describe the moodboard vibe in your brief.';
      } catch (e) {
        console.warn('Claude brief parse failed, falling back:', e.message);
        brief = parseBriefText(briefText);
        brief.parsedBy = 'regex-fallback';
      }
    } else {
      brief = parseBriefText(briefText);
      brief.parsedBy = 'regex';
      if (pdfKeywords) {
        const pdfBrief = parseBriefText(pdfKeywords);
        for (const tag of pdfBrief.styleTags) if (!brief.styleTags.includes(tag)) brief.styleTags.push(tag);
        for (const tag of pdfBrief.paletteTags) if (!brief.paletteTags.includes(tag)) brief.paletteTags.push(tag);
        brief.moodboardNote = 'Moodboard keywords extracted and merged.';
      } else if (hasMoodboard) {
        brief.moodboardNote = 'Image-based moodboard — add ANTHROPIC_API_KEY to Netlify for smarter recommendations.';
      }
    }

    // ── Load catalog ─────────────────────────────────────────────────────────
    const store = getStore('catalog');
    const raw = await store.get('records', { type: 'text' });
    if (!raw) {
      return NextResponse.json({ error: 'No catalog loaded. Please upload your catalog first.' }, { status: 400 });
    }

    let allRecords;
    try {
      allRecords = JSON.parse(raw);
    } catch (e) {
      return NextResponse.json({ error: 'Catalog data corrupted.' }, { status: 500 });
    }

    // ── Smart sampling: guarantee style-matching records are included ─────────
    let sample;
    if (allRecords.length > 2000 && brief.styleTags.length > 0) {
      const tagged = allRecords.map(tagRecord);
      const relevant = tagged.filter(r =>
        brief.styleTags.some(s => (r.style || []).includes(s))
      );
      const irrelevant = tagged.filter(r =>
        !brief.styleTags.some(s => (r.style || []).includes(s))
      );
      const fillCount = Math.max(0, 2000 - relevant.length);
      const randomFill = [...irrelevant].sort(() => 0.5 - Math.random()).slice(0, fillCount);
      sample = [...relevant, ...randomFill];
    } else {
      sample = (allRecords.length > 2000
        ? [...allRecords].sort(() => 0.5 - Math.random()).slice(0, 2000)
        : allRecords
      ).map(tagRecord);
    }

    // ── Keyword scoring ───────────────────────────────────────────────────────
    const scored = sample
      .map(r => ({ ...r, score: scoreRecord(r, brief) }))
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score);

    // ── Deduplicate by artwork family ─────────────────────────────────────────
    const seen = new Set();
    const deduped = [];
    for (const r of scored.slice(0, 80)) {
      const key = (r.product_handle || '').replace(/-\d+$/, '');
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(normalize(r));
      }
    }

    // ── LLM re-ranking (if API key available) ─────────────────────────────────
    let finalResults;
    if (hasAnthropicKey && deduped.length >= 5) {
      try {
        const reranked = await rerankWithClaude(brief, deduped);
        finalResults = reranked.length >= 8 ? reranked : deduped.slice(0, 20);
      } catch (e) {
        console.warn('Re-rank failed, using keyword order:', e.message);
        finalResults = deduped.slice(0, 20);
      }
    } else {
      finalResults = deduped.slice(0, 20);
    }

    // ── Gallery wall sets ─────────────────────────────────────────────────────
    const galleryWallSets = brief.galleryWall
      ? [
          { setNumber: 1, theme: (brief.keyThemes || brief.styleTags || [])[0] || 'curated', items: finalResults.slice(0, 5) },
          { setNumber: 2, theme: (brief.keyThemes || brief.styleTags || [])[1] || 'accent', items: finalResults.slice(5, 10) },
        ]
      : [];

    return NextResponse.json({
      brief,
      primary: finalResults.slice(0, 8),
      accent: finalResults.slice(8, 16),
      galleryWallSets,
      totalScored: scored.length,
      catalogSize: allRecords.length,
    });

  } catch (err) {
    console.error('Recommend error:', err);
    return NextResponse.json({ error: err.message || 'Failed to generate recommendations' }, { status: 500 });
  }
}
