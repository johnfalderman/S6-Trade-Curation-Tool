import { NextResponse } from 'next/server';
import { getStore } from '@netlify/blobs';

// ─── Brief Parser ────────────────────────────────────────────────────────────
// Parses structured Jotform-style text line by line so fields like
// "Project Type: Hotel" don't get confused with room names like "Restaurant, Bar"

function parseBriefText(text) {
  if (!text) return defaultBrief();
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // Extract labeled fields first (before free-text scanning)
  const get = (label) => {
    const re = new RegExp(`^${label}\\s*[:\\-]\\s*(.+)`, 'i');
    for (const line of lines) {
      const m = line.match(re);
      if (m) return m[1].trim();
    }
    return '';
  };

  const projectName = get('Project Name') || get('Name');

  // Project type — from the labeled field only, not the full body
  const projectTypeLine = (get('Project Type') || get('Type')).toLowerCase();
  let projectType = 'other';
  if (/restaurant|dining|cafe|bar/.test(projectTypeLine)) projectType = 'restaurant';
  else if (/hotel|hospitality|resort/.test(projectTypeLine)) projectType = 'hotel';
  else if (/vacation rental|vrbo|airbnb|short.?term/.test(projectTypeLine)) projectType = 'vacation_rental';
  else if (/office|corporate|workspace/.test(projectTypeLine)) projectType = 'office';

  // Piece count — handle both "Target Pieces: 80" and "80 pieces"
  const pieceField = get('Target Pieces') || get('Pieces') || get('Target');
  let pieceCount = 10;
  if (pieceField) {
    const num = pieceField.match(/(\d+)/);
    if (num) pieceCount = parseInt(num[1]);
  } else {
    const inBody = text.match(/(\d+)\s*(piece|print|artwork)/i);
    if (inBody) pieceCount = parseInt(inBody[1]);
  }

  // Rooms
  const roomsField = get('Rooms') || get('Spaces');
  const rooms = roomsField
    ? roomsField.split(/,|;/).map(r => r.trim()).filter(Boolean)
    : [];

  // Gallery wall
  const galleryField = (get('Gallery Wall') || get('Gallery')).toLowerCase();
  const galleryWall = galleryField.includes('yes') || text.toLowerCase().includes('gallery wall: yes');

  // Style tags — from the labeled field + free-text scan of the whole body
  const styleField = (get('Design Style') || get('Style') || '').toLowerCase();
  const fullLower = text.toLowerCase();

  const styleMap = {
    modern:       ['modern', 'contemporary', 'minimal', 'minimalist', 'clean'],
    vintage:      ['vintage', 'retro', 'antique', 'classic'],
    coastal:      ['coastal', 'beach', 'ocean', 'nautical', 'seaside'],
    southern:     ['southern', 'rustic', 'farmhouse', 'country', 'western', 'boho', 'bohemian'],
    abstract:     ['abstract', 'expressionist', 'geometric', 'non-representational'],
    photography:  ['photo', 'photograph', 'photography', 'realistic'],
    illustration: ['illustration', 'illustrated', 'drawing', 'sketch'],
    dramatic:     ['dramatic', 'bold', 'statement', 'impactful', 'striking'],
    music:        ['music', 'jazz', 'blues', 'rock', 'band', 'concert', 'vinyl', 'instrument', 'guitar', 'piano', 'trumpet'],
    urban:        ['urban', 'city', 'street', 'industrial', 'metropolitan', 'downtown'],
  };
  const styleTags = [];
  for (const [tag, kws] of Object.entries(styleMap)) {
    if (kws.some(kw => styleField.includes(kw) || fullLower.includes(kw))) styleTags.push(tag);
  }

  // Palette tags — from the labeled field + full body
  const paletteField = (get('Color Palette') || get('Palette') || get('Colors') || '').toLowerCase();
  const paletteMap = {
    purple:   ['purple', 'violet', 'lavender', 'plum', 'mauve', 'amethyst'],
    neutral:  ['neutral', 'beige', 'tan', 'cream', 'ivory', 'white', 'warm white', 'off-white'],
    blue:     ['blue', 'navy', 'teal', 'cobalt', 'indigo', 'cerulean'],
    green:    ['green', 'sage', 'olive', 'forest', 'emerald', 'mint'],
    orange:   ['orange', 'terracotta', 'rust', 'burnt orange', 'amber', 'copper'],
    pink:     ['pink', 'blush', 'rose', 'coral', 'magenta'],
    black:    ['black', 'dark', 'charcoal', 'ebony', 'onyx'],
    metallic: ['gold', 'silver', 'metallic', 'brass', 'bronze', 'chrome'],
    warm:     ['warm', 'earthy', 'earth tone'],
    red:      ['red', 'crimson', 'burgundy', 'wine', 'maroon'],
  };
  const paletteTags = [];
  for (const [tag, kws] of Object.entries(paletteMap)) {
    if (kws.some(kw => paletteField.includes(kw))) paletteTags.push(tag);
  }

  // Avoid tags — only from the labeled avoid field, not free text
  const avoidField = (get('Avoid') || get('Avoid:') || '').toLowerCase();
  const avoidMap = {
    light:       ['light', 'airy', 'pastel', 'soft', 'delicate', 'bright', 'white'],
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
    if (kws.some(kw => avoidField.includes(kw))) avoidTags.push(tag);
  }

  return { projectName, projectType, styleTags, paletteTags, avoidTags, galleryWall, pieceCount, rooms };
}

function defaultBrief() {
  return { projectName: '', projectType: 'other', styleTags: [], paletteTags: [], avoidTags: [], galleryWall: false, pieceCount: 10, rooms: [] };
}

// ─── Catalog Tagging & Scoring ───────────────────────────────────────────────

function tagRecord(r) {
  const text = ((r.title || '') + ' ' + (r.image_alt || '') + ' ' + (r.source_collection || '') + ' ' + (r.product_handle || '')).toLowerCase();
  const style = [];
  const palette = [];

  if (/jazz|blues|rock|music|band|concert|vinyl|instrument|guitar|piano|trumpet|saxophone|drum/.test(text)) style.push('music');
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
  if (/dramatic|bold|dark|moody/.test(text)) style.push('dramatic');
  if (/southern|rustic|farmhouse|country/.test(text)) style.push('southern');

  if (/purple|violet|lavender|plum|amethyst/.test(text)) palette.push('purple');
  if (/blue|navy|teal|indigo|cobalt/.test(text)) palette.push('blue');
  if (/green|sage|olive|forest|emerald/.test(text)) palette.push('green');
  if (/black|dark|charcoal|ebony/.test(text)) palette.push('black');
  if (/gold|silver|metallic|brass|bronze/.test(text)) palette.push('metallic');
  if (/red|crimson|burgundy|wine|maroon/.test(text)) palette.push('red');
  if (/orange|terracotta|rust|amber/.test(text)) palette.push('orange');
  if (/pink|blush|rose|coral/.test(text)) palette.push('pink');
  if (/neutral|beige|ivory|cream/.test(text)) palette.push('neutral');
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
  for (const a of brief.avoidTags) {
    if (style.includes(a) || text.includes(a)) score -= 5;
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

// ─── PDF Text Extraction ─────────────────────────────────────────────────────

async function extractPdfKeywords(fileBuffer) {
  try {
    // Dynamic import so build doesn't fail if pdf-parse has issues
    const pdfParse = (await import('pdf-parse')).default;
    const data = await pdfParse(fileBuffer);
    return data.text || '';
  } catch (e) {
    console.warn('PDF parse failed (image-based moodboard?):', e.message);
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
      // File upload path
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
      // JSON path (no file)
      const body = await request.json();
      briefText = body.brief || '';
      moodboardUrl = body.moodboardUrl || '';
    }

    // Parse the brief
    const brief = parseBriefText(briefText);

    // If the PDF had extractable text, blend its keywords into the brief
    if (pdfKeywords) {
      const pdfBrief = parseBriefText(pdfKeywords);
      // Merge without duplicating
      for (const tag of pdfBrief.styleTags) {
        if (!brief.styleTags.includes(tag)) brief.styleTags.push(tag);
      }
      for (const tag of pdfBrief.paletteTags) {
        if (!brief.paletteTags.includes(tag)) brief.paletteTags.push(tag);
      }
      brief.moodboardNote = 'Keywords extracted from uploaded moodboard PDF.';
    } else if (hasMoodboard) {
      brief.moodboardNote = 'Image-based moodboard received — text extraction not possible. Recommendations based on brief text only.';
    }

    // Load catalog
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

    // Sample up to 2000 records for speed (avoids serverless timeout)
    const sample = allRecords.length > 2000
      ? [...allRecords].sort(() => 0.5 - Math.random()).slice(0, 2000)
      : allRecords;

    const scored = sample
      .map(tagRecord)
      .map(r => ({ ...r, score: scoreRecord(r, brief) }))
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score);

    const top30 = scored.slice(0, 30).map(normalize);

    // Deduplicate by artwork family
    const seen = new Set();
    const deduped = [];
    for (const r of top30) {
      const key = (r.product_handle || '').replace(/-\d+$/, '');
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(r);
      }
    }

    // Gallery wall sets — objects with setNumber, theme, items (matches page.jsx)
    const galleryWallSets = brief.galleryWall
      ? [
          { setNumber: 1, theme: brief.styleTags[0] || 'curated', items: deduped.slice(0, 5) },
          { setNumber: 2, theme: brief.styleTags[1] || 'accent', items: deduped.slice(5, 10) },
        ]
      : [];

    return NextResponse.json({
      brief,
      primary: deduped.slice(0, 8),
      accent: deduped.slice(8, 16),
      galleryWallSets,
      totalScored: scored.length,
      catalogSize: allRecords.length,
    });
  } catch (err) {
    console.error('Recommend error:', err);
    return NextResponse.json({ error: err.message || 'Failed to generate recommendations' }, { status: 500 });
  }
}
