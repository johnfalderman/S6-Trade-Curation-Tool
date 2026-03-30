import { NextResponse } from 'next/server';
import { getStore } from '@netlify/blobs';

function parseBrief(text) {
  if (!text) return { styleTags: [], paletteTags: [], avoidTags: [], galleryWall: false, projectType: 'other', pieceCount: 10 };
  const lower = text.toLowerCase();
  const styleTags = [];
  const paletteTags = [];
  const avoidTags = [];

  // Style detection
  const styleMap = {
    modern: ['modern', 'contemporary', 'minimal', 'minimalist', 'clean'],
    vintage: ['vintage', 'retro', 'antique', 'classic', 'old world'],
    coastal: ['coastal', 'beach', 'ocean', 'nautical', 'seaside', 'surf'],
    southern: ['southern', 'rustic', 'farmhouse', 'country', 'western', 'boho', 'bohemian'],
    abstract: ['abstract', 'expressionist', 'geometric', 'non-representational'],
    photography: ['photo', 'photograph', 'photography', 'realistic'],
    illustration: ['illustration', 'illustrated', 'drawing', 'sketch'],
    dramatic: ['dramatic', 'bold', 'statement', 'impactful', 'striking'],
    music: ['music', 'jazz', 'blues', 'rock', 'band', 'concert', 'vinyl', 'instrument', 'guitar', 'piano', 'trumpet'],
    urban: ['urban', 'city', 'street', 'industrial', 'metropolitan', 'downtown'],
  };
  for (const [tag, keywords] of Object.entries(styleMap)) {
    if (keywords.some(kw => lower.includes(kw))) styleTags.push(tag);
  }

  // Palette detection
  const paletteMap = {
    purple: ['purple', 'violet', 'lavender', 'plum', 'mauve', 'amethyst'],
    neutral: ['neutral', 'beige', 'tan', 'cream', 'ivory', 'white', 'warm white', 'off-white'],
    blue: ['blue', 'navy', 'teal', 'cobalt', 'indigo', 'cerulean'],
    green: ['green', 'sage', 'olive', 'forest', 'emerald', 'mint'],
    orange: ['orange', 'terracotta', 'rust', 'burnt orange', 'amber', 'copper'],
    pink: ['pink', 'blush', 'rose', 'coral', 'magenta'],
    black: ['black', 'dark', 'charcoal', 'ebony', 'onyx', 'deep', 'moody'],
    metallic: ['gold', 'silver', 'metallic', 'brass', 'bronze', 'chrome', 'iridescent'],
    warm: ['warm', 'earthy', 'earth tone'],
    red: ['red', 'crimson', 'burgundy', 'wine', 'maroon'],
  };
  for (const [tag, keywords] of Object.entries(paletteMap)) {
    if (keywords.some(kw => lower.includes(kw))) paletteTags.push(tag);
  }

  // Avoid detection
  const avoidMap = {
    light: ['light', 'airy', 'pastel', 'soft', 'delicate'],
    floral: ['floral', 'flowers', 'botanical', 'garden'],
    kids: ['kids', 'children', 'nursery', 'playful', 'cartoon'],
    landscape: ['landscape', 'nature', 'scenery'],
    typography: ['typography', 'text', 'words', 'quotes', 'lettering'],
  };
  const avoidSection = lower.includes('avoid') ? lower.slice(lower.indexOf('avoid')) : '';
  for (const [tag, keywords] of Object.entries(avoidMap)) {
    if (keywords.some(kw => avoidSection.includes(kw))) avoidTags.push(tag);
  }

  const galleryWall = lower.includes('gallery wall') || lower.includes('gallery-wall');

  let projectType = 'other';
  if (lower.includes('restaurant') || lower.includes('dining') || lower.includes('cafe') || lower.includes('bar')) projectType = 'restaurant';
  else if (lower.includes('hotel') || lower.includes('hospitality') || lower.includes('resort')) projectType = 'hotel';
  else if (lower.includes('vacation rental') || lower.includes('vrbo') || lower.includes('airbnb') || lower.includes('short-term')) projectType = 'vacation_rental';
  else if (lower.includes('office') || lower.includes('corporate') || lower.includes('workspace')) projectType = 'office';

  const pieceMatch = lower.match(/(\d+)\s*(piece|print|artwork|work)/);
  const pieceCount = pieceMatch ? parseInt(pieceMatch[1]) : 10;

  return { styleTags, paletteTags, avoidTags, galleryWall, projectType, pieceCount };
}

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
  if (/typography|lettering|quote|word|text/.test(text)) style.push('typography');
  if (/city|urban|street|skyline|downtown/.test(text)) style.push('urban');
  if (/animal|cat|dog|bird|wildlife/.test(text)) style.push('animal');
  if (/dramatic|bold|dark|moody/.test(text)) style.push('dramatic');

  if (/purple|violet|lavender|plum|amethyst/.test(text)) palette.push('purple');
  if (/blue|navy|teal|indigo|cobalt/.test(text)) palette.push('blue');
  if (/green|sage|olive|forest|emerald/.test(text)) palette.push('green');
  if (/black|dark|charcoal|ebony/.test(text)) palette.push('black');
  if (/gold|silver|metallic|brass|bronze/.test(text)) palette.push('metallic');
  if (/red|crimson|burgundy|wine|maroon/.test(text)) palette.push('red');
  if (/orange|terracotta|rust|amber/.test(text)) palette.push('orange');
  if (/pink|blush|rose|coral/.test(text)) palette.push('pink');
  if (/neutral|beige|ivory|cream|white/.test(text)) palette.push('neutral');
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

  // Collection type bonus
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

export async function POST(request) {
  try {
    const body = await request.json();
    const briefText = body.brief || '';
    const brief = parseBrief(briefText);

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

    // Sample up to 2000 records for speed
    const sample = allRecords.length > 2000
      ? [...allRecords].sort(() => 0.5 - Math.random()).slice(0, 2000)
      : allRecords;

    const scored = sample
      .map(tagRecord)
      .map(r => ({ ...r, score: scoreRecord(r, brief) }))
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score);

    const top30 = scored.slice(0, 30).map(normalize);

    // Deduplicate by artwork family / handle prefix
    const seen = new Set();
    const deduped = [];
    for (const r of top30) {
      const key = (r.product_handle || '').replace(/-\d+$/, '');
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(r);
      }
    }

    const primaryCollection = deduped.slice(0, 8);
    const accentAndExpansion = deduped.slice(8, 16);
    const galleryWallSets = brief.galleryWall ? [deduped.slice(0, 5), deduped.slice(5, 10)] : [];

    return NextResponse.json({
      brief,
      primaryCollection,
      accentAndExpansion,
      galleryWallSets,
      meta: {
        totalScored: scored.length,
        sampleSize: sample.length,
        totalCatalog: allRecords.length,
      }
    });
  } catch (err) {
    console.error('Recommend error:', err);
    return NextResponse.json({ error: err.message || 'Failed to generate recommendations' }, { status: 500 });
  }
}
