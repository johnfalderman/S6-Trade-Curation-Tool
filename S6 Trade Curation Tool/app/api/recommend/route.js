import { NextResponse } from 'next/server';
import { getStore } from '@netlify/blobs';

// ─── LLM Brief Parser ─────────────────────────────────────────────────────────
async function parseBriefWithClaude(text) {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [{ role: 'user', content: `You are an interior design trade art curation assistant. Parse this Jotform curation brief into structured JSON.

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
  "keyThemes": ["3-6 short vibe or theme phrases extracted from the brief — e.g. 'jazz club', 'music posters', 'dark moody', 'old school art', 'vinyl records', 'modern southern coastal'"],
  "rooms": ["list of room types mentioned"],
  "searchKeywords": ["10-20 individual words that describe artworks fitting this brief — e.g. 'jazz', 'saxophone', 'trumpet', 'vinyl', 'concert', 'musician', 'dark', 'purple', 'moody', 'vintage poster'"]
}` }]
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
    get('Avoid') || get('Anything we should avoid') || get('What to avoid') || get('Avoid during') || ''
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

  // Generate searchKeywords from styleTags + paletteTags for keyword scoring
  const searchKeywords = [...styleTags, ...paletteTags];

  return { projectName, projectType, styleTags, paletteTags, avoidTags, galleryWall, pieceCount, rooms, keyThemes: styleTags, searchKeywords };
}

function defaultBrief() {
  return { projectName: '', projectType: 'other', styleTags: [], paletteTags: [], avoidTags: [], galleryWall: false, pieceCount: 10, rooms: [], keyThemes: [], searchKeywords: [] };
}

// ─── Catalog Tagging ──────────────────────────────────────────────────────────
function tagRecord(r) {
  const text = ((r.title || '') + ' ' + (r.image_alt || '') + ' ' + (r.source_collection || '') + ' ' + (r.product_handle || '')).toLowerCase();

  const style = [];
  const palette = [];

  // Style tags — order matters, more specific first
  if (/jazz|blues|rock|hip.?hop|music|band|concert|vinyl|instrument|guitar|piano|trumpet|saxophone|drum|melody|music.?note|treble|clef|acoustic|musician|album|lyric|harmony|rhythm|song|record.?player|music.?poster|boombox|microphone|headphone|speaker|turntable/.test(text)) style.push('music');
  if (/abstract|geometric|expressionist|generative|surreal/.test(text)) style.push('abstract');
  if (/photo|photograph/.test(text)) style.push('photography');
  if (/illustrat|drawing|sketch/.test(text)) style.push('illustration');
  if (/vintage|retro|antique|throwback|old.?school/.test(text)) style.push('vintage');
  if (/modern|contemporary|minimal|minimalist/.test(text)) style.push('modern');
  if (/coastal|beach|ocean|nautical|wave|surf|sea/.test(text)) style.push('coastal');
  if (/floral|flower|botanical|garden|bloom|blossom|petal/.test(text)) style.push('floral');
  if (/landscape|mountain|forest|nature|scenic|countryside/.test(text)) style.push('landscape');
  if (/typography|lettering|quote|word|phrase|saying/.test(text)) style.push('typography');
  if (/city|urban|street|skyline|downtown|metropolitan/.test(text)) style.push('urban');
  if (/animal|cat|dog|bird|wildlife|fox|wolf|bear|deer/.test(text)) style.push('animal');
  if (/dark|moody|noir|dramatic|bold|gritty/.test(text)) style.push('dramatic');
  if (/southern|rustic|farmhouse|country|boho|bohemian/.test(text)) style.push('southern');
  if (/watercolor|pastel|soft|airy|light|bright|spring|sunshine|delicate/.test(text)) style.push('light');

  // Palette tags
  if (/purple|violet|lavender|plum|amethyst|mauve/.test(text)) palette.push('purple');
  if (/blue|navy|teal|indigo|cobalt|cerulean/.test(text)) palette.push('blue');
  if (/green|sage|olive|forest|emerald/.test(text)) palette.push('green');
  if (/black|dark|charcoal|ebony|noir|onyx/.test(text)) palette.push('black');
  if (/gold|silver|metallic|brass|bronze|chrome|gilded/.test(text)) palette.push('metallic');
  if (/red|crimson|burgundy|wine|maroon|scarlet/.test(text)) palette.push('red');
  if (/orange|terracotta|rust|amber|burnt/.test(text)) palette.push('orange');
  if (/pink|blush|rose|coral|magenta/.test(text)) palette.push('pink');
  if (/neutral|beige|ivory|cream|tan|linen/.test(text)) palette.push('neutral');
  if (/warm|earthy|earth.?tone|sienna|ochre/.test(text)) palette.push('warm');

  return { ...r, style, palette };
}

// ─── Scoring ──────────────────────────────────────────────────────────────────
function scoreRecord(r, brief) {
  let score = 0;
  const style   = r.style   || [];
  const palette = r.palette || [];
  const text    = ((r.title || '') + ' ' + (r.image_alt || '') + ' ' + (r.product_handle || '')).toLowerCase();

  // Style tag matches (+3 each)
  for (const s of brief.styleTags || []) {
    if (style.includes(s)) score += 3;
  }

  // Palette matches (+2 each)
  for (const p of brief.paletteTags || []) {
    if (palette.includes(p)) score += 2;
  }

  // ── KEY FIX: searchKeywords from Claude's response ──
  // These are specific words like "jazz", "saxophone", "vinyl", "turntable"
  // that directly match catalog text — parallel much more precise than style buckets
  for (const kw of brief.searchKeywords || []) {
    if (kw.length >= 3 && text.includes(kw.toLowerCase())) score += 4;
  }

  // ── KEY FIX: keyThemes phrase matching ──
  // Split each theme into words and score each word found in record text
  for (const theme of brief.keyThemes || []) {
    const words = theme.toLowerCase().split(/\s+/).filter(w => w.length >= 4);
    for (const word of words) {
      if (text.includes(word)) score += 2;
    }
  }

  // Hard penalize avoid tags
  for (const a of brief.avoidTags || []) {
    if (style.includes(a) || text.includes(a)) score -= 8;
  }

  // Penalize "light" when brief wants dark/dramatic
  if (style.includes('light') && (
    (brief.paletteTags || []).includes('black') ||
    (brief.styleTags   || []).includes('dramatic')
  )) {
    score -= 5;
  }

  // Small boost for premium collections
  if (r.sourcion) {
    if (r.source_collection.includes('art-print'))     score += 1;
    if (r.source_collection.includes('canvas'))        score += 1;
    if (r.source_collection.includes('best-selling'))  score += 1;
  }

  return score;
}

function normalize(r) {
  const base = 'https://society6.com';
  return {
    ...r,
    product_url: r.product_url ? (r.product_url.startsWith('http') ? r.product_url : base + r.product_url) : '',
    image_url:   r.image_url   ? (r.image_url.startsWith('http')   ? r.image_url   : base + r.image_url)   : '',
  };
}

// ─── PDF Extraction (with timeout) ───────────────────────────────────────────
async function extractPdfKeywords(fileBuffer) {
  try {
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('PDF timeout')), 4000)
    );
    const parsePromise = (async () => {
      const pdfParse = (await import('pdf-parse')).default;
      const data = await pdfParse(fileBuffer);
      return data.text || '';
    })();
    return await Promise.race([parsePromise, timeoutPromise]);
  } catch (e) {
    console.warn('PDF parse skipped:', e.message);
    return '';
  }
}

// ─── Route Handler ────────────────────────────────────────────────────────────
export async function POST(request) {
  try {
    let briefText    = '';
    let moodboardUrl = '';
    let pdfKeywords  = '';
    let hasMoodboard = false;
    let refineFeedback = '';
    let pinnedUrls     = [];

    const contentType = request.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      briefText      = formData.get('brief')         || '';
      moodboardUrl   = formData.get('moodboardUrl')  || '';
      refineFeedback = formData.get('refineFeedback')|| '';
      try { pinnedUrls = JSON.parse(formData.get('pinnedUrls') || '[]'); } catch {}

      const file = formData.get('moodboard');
      if (file && file.size > 0) {
        hasMoodboard = true;
        try {
          const buffer = Buffer.from(await file.arrayBuffer());
          pdfKeywords = await extractPdfKeywords(buffer);
        } catch (e) {
          console.warn('Moodboard file processing skipped:', e.message);
        }
      }
    } else {
      const body     = await request.json();
      briefText      = body.brief          || '';
      moodboardUrl   = body.moodboardUrl   || '';
      refineFeedback = body.refineFeedback || '';
      pinnedUrls     = body.pinnedUrls     || [];
    }

    const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;
    const store = getStore('catalog');

    let fullText = pdfKeywords
      ? `${briefText}\n\n--- MOODBOARD NOTES ---\n${pdfKeywords}`
      : briefText;
    if (refineFeedback) fullText += `\n\n--- USER REFINEMENT FEEDBACK ---\n${refineFeedback}`;

    // Parse brief + load catalog in parallel
    let briefResult, raw;
    if (hasAnthropicKey) {
      [briefResult, raw] = await Promise.all([
        parseBriefWithClaude(fullText).catch(e => {
          console.warn('Claude brief parse failed, falling back:', e.message);
          return null;
        }),
        store.get('records', { type: 'text' }),
      ]);
    } else {
      raw = await store.get('records', { type: 'text' });
      briefResult = null;
    }

    if (!raw) {
      return NextResponse.json({ error: 'No catalog loaded. Please upload your catalog first.' }, { status: 400 });
    }

    let brief;
    if (briefResult) {
      brief = briefResult;
      brief.parsedBy = 'claude';
      // Ensure searchKeywords always exists
      if (!brief.searchKeywords) brief.searchKeywords = [...(brief.styleTags || []), ...(brief.paletteTags || [])];
      if (pdfKeywords)   brief.moodboardNote = 'Moodboard text extracted and incorporated into recommendations.';
      else if (hasMoodboard) brief.moodboardNote = 'Image-based moodboard received. For best results, describe the moodboard vibe in your brief.';
    } else {
      brief = parseBriefText(briefText);
      brief.parsedBy = hasAnthropicKey ? 'regex-fallback' : 'regex';
      if (pdfKeywords) {
        const pdfBrief = parseBriefText(pdfKeywords);
        for (const tag of pdfBrief.styleTags)  if (!brief.styleTags.includes(tag))  brief.styleTags.push(tag);
        for (const tag of pdfBrief.paletteTags) if (!brief.paletteTags.includes(tag)) brief.paletteTags.push(tag);
        brief.moodboardNote = 'Moodboard keywords extracted and merged.';
      } else if (hasMoodboard) {
        brief.moodboardNote = 'Image-based moodboard — add ANTHROPIC_API_KEY to Netlify for smarter recommendations.';
      }
    }

    let allRecords;
    try {
      allRecords = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: 'Catalog data corrupted.' }, { status: 500 });
    }

    // ── Smart sampling: guarantee style-matching records are in the pool ──────
    let sample;
    const SAMPLE_SIZE = 3000;
    if (allRecords.length > SAMPLE_SIZE && brief.styleTags.length > 0) {
      const tagged    = allRecords.map(tagRecord);
      const relevant  = tagged.filter(r => brief.styleTags.some(s => (r.style || []).includes(s)));
      const irrelevant = tagged.filter(r => !brief.styleTags.some(s => (r.style || []).includes(s)));
      const fillCount = Math.max(0, SAMPLE_SIZE - relevant.length);
      const randomFill = [...irrelevant].sort(() => 0.5 - Math.random()).slice(0, fillCount);
      sample = [...relevant, ...randomFill];
    } else {
      sample = (allRecords.length > SAMPLE_SIZE
        ? [...allRecords].sort(() => 0.5 - Math.random()).slice(0, SAMPLE_SIZE)
        : allRecords
      ).map(tagRecord);
    }

    // ── Score everything — include negatives only for hard avoid matches ──────
    const scored = sample
      .map(r => ({ ...r, score: scoreRecord(r, brief) }))
      .filter(r => r.score > -3)          // only cut items that are truly avoided
      .sort((a, b) => b.score - a.score);

    // ── Deduplicate by artwork family ─────────────────────────────────────────
    const seen   = new Set();
    const deduped = [];
    for (const r of scored.slice(0, 300)) {
      const key = (r.product_handle || '').replace(/-\d+$/, '');
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(normalize(r));
      }
    }

    // ── Pinned items — force-include specific Society6 URLs ───────────────────
    const pinnedRecords = [];
    if (pinnedUrls.length > 0) {
      for (const url of pinnedUrls) {
        const handle = url.split('/products/')[1]?.split('?')[0]?.split('/')[0];
        if (!handle) continue;
        const found = allRecords.find(r =>
          r.product_handle === handle || (r.product_url || '').includes(handle)
        );
        if (found) pinnedRecords.push({ ...normalize(tagRecord(found)), pinned: true });
      }
    }

    // ── Build final sets ──────────────────────────────────────────────────────
    const pinnedUrlSet  = new Set(pinnedRecords.map(r => r.product_url));
    const unpinned      = deduped.filter(r => !pinnedUrlSet.has(r.product_url));
    const mergedResults = [...pinnedRecords, ...unpinned];

    const PRIMARY_COUNT = 20;
    const ACCENT_COUNT  = 15;

    // ── Gallery wall sets ─────────────────────────────────────────────────────
    const galleryWallSets = brief.galleryWall ? [
      { setNumber: 1, theme: (brief.keyThemes || brief.styleTags || [])[0] || 'curated', items: mergedResults.slice(0, 6) },
      { setNumber: 2, theme: (brief.keyThemes || brief.styleTags || [])[1] || 'accent',  items: mergedResults.slice(6, 12) },
    ] : [];

    return NextResponse.json({
      brief,
      primary:        mergedResults.slice(0, PRIMARY_COUNT),
      accent:         mergedResults.slice(PRIMARY_COUNT, PRIMARY_COUNT + ACCENT_COUNT),
      galleryWallSets,
      totalScored:    scored.length,
      catalogSize:    allRecords.length,
    });

  } catch (err) {
    console.error('Recommend error:', err);
    return NextResponse.json({ error: err.message || 'Failed to generate recommendations' }, { status: 500 });
  }
}
