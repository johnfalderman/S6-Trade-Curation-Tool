import { NextResponse } from 'next/server';
import { getStore } from '@netlify/blobs';

// âââ Stage 1: Claude parses the brief into structured data ââââââââââââââââââ
async function parseBriefWithClaude(text) {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: `You are an interior design trade art curation assistant. Parse this Jotform curation brief into structured JSON.

The brief may be in any format â a direct form response, a copied email, a freeform description, or a structured list.

BRIEF TEXT:
${text}

Return ONLY valid JSON (no markdown, no explanation) with exactly these fields:
{
  "projectName": "look for 'Design Project', 'Design Project Name', or 'Project Name' label. Use value exactly, or empty string.",
  "clientName": "look for 'Company Name', 'Client Name', 'Property Name', 'Business Name', or 'Company' label. Use value exactly.",
  "location": "city and state/country (look for Location, City, Address, or any geographic reference)",
  "projectType": "hotel|restaurant|vacation_rental|office|other",
  "styleTags": ["art style keywords â e.g. modern, vintage, abstract, photography, coastal, dramatic, music, urban, bohemian, minimalist, rustic"],
  "paletteTags": ["color keywords â e.g. purple, dark, blue, neutral, green, warm, black, metallic, earthy, red"],
  "avoidTags": ["things to explicitly avoid â e.g. floral, kids, landscape, typography, abstract, dark, bright, pastel"],
  "galleryWall": true or false,
  "targetPieceCount": number or null,
  "keyThemes": ["3-6 short vibe phrases â e.g. 'jazz club atmosphere', 'coastal modern', 'dark moody', 'music venue', 'southern charm'"],
  "rooms": ["room types mentioned"],
  "searchKeywords": ["15-25 individual words that describe artwork fitting this brief â very specific words like 'saxophone', 'vinyl', 'turntable', 'cobalt', 'terracotta', 'geometric' â that would match artwork titles or descriptions"],
  "briefSummary": "2-3 sentence plain English summary of what this client needs"
}`
    }]
  });

  const jsonStr = message.content[0].text.trim();
  return JSON.parse(jsonStr);
}

// âââ Stage 2: Claude selects the best artworks from candidates ââââââââââââââ
async function selectWithClaude(candidates, brief, prevItemTitles = [], feedback = '') {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const catalogList = candidates.slice(0, 200).map((r, i) =>
    `${i}|${r.title}|${r.source_collection}|${r.product_handle}`
  ).join('\n');

  const refinementContext = prevItemTitles.length > 0
    ? `\nPREVIOUSLY SHOWN TO CLIENT (do not repeat these unless explicitly asked):
${prevItemTitles.slice(0, 25).join('\n')}
CLIENT FEEDBACK: "${feedback}"
Select DIFFERENT artworks that directly address this feedback.`
    : '';

  const avoidLine = (brief.avoidTags || []).length > 0
    ? `Avoid anything with these qualities: ${brief.avoidTags.join(', ')}.`
    : '';

  const prompt = `You are an expert art curator for Society6's trade program. You select wall art for interior designers, hotels, restaurants, and vacation rental owners. Your curation choices reflect genuine aesthetic judgment â not just keyword matching.

CLIENT BRIEF:
${brief.briefSummary || ''}
Project: ${brief.projectName || 'Trade Client'} (${brief.projectType || 'commercial'})
Style: ${(brief.styleTags || []).join(', ') || 'not specified'}
Palette: ${(brief.paletteTags || []).join(', ') || 'not specified'}
Themes: ${(brief.keyThemes || []).join(', ') || 'not specified'}
${avoidLine}
${refinementContext}

CATALOG OPTIONS (index|title|collection|handle):
${catalogList}

Your task: Select the 20 artworks that best serve this client. Think like a curator â consider:
- Does the title/subject matter fit the space and mood?
- Does the collection source suggest the right medium (art print, canvas, etc.)?
- Does the artwork cohesively contribute to a curated set â not just 20 random good pieces?
${prevItemTitles.length > 0 ? '- The client has already seen the "previously shown" list â give them genuinely different options.' : ''}

Return ONLY a valid JSON array with no markdown or explanation:
[{"index": 0, "handle": "exact-product-handle", "reason": "one specific sentence explaining why this piece fits the brief"}]`;

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2500,
    messages: [{ role: 'user', content: prompt }]
  });

  let raw = message.content[0].text.trim();
  // Strip any accidental markdown fences
  raw = raw.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '');
  return JSON.parse(raw);
}

// âââ Regex Brief Parser (fallback when no API key) ââââââââââââââââââââââââââ
function parseBriefFallback(text) {
  if (!text) return defaultBrief();

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const get = (label) => {
    const re = new RegExp(`(?:^|[\\?])\\s*${label}\\s*[:\\-\\?]\\s*(.+)`, 'i');
    for (const line of lines) {
      const m = line.match(re);
      if (m) return m[1].trim();
    }
    return '';
  };

  const projectName = get('Design Project') || get('Design Project Name') || get('Project Name') || get('Name') || get('Project');
  const clientName = get('Company Name') || get('Client Name') || get('Property Name') || get('Business Name') || get('Company') || '';
  const location = get('Location') || get('City') || get('Project Location') || '';

  const projectTypeLine = (get('Project Type') || get('Type') || '').toLowerCase();
  let projectType = 'other';
  if (/restaurant|dining|cafe|bar/.test(projectTypeLine)) projectType = 'restaurant';
  else if (/hotel|hospitality|resort/.test(projectTypeLine)) projectType = 'hotel';
  else if (/vacation rental|vrbo|airbnb|short.?term/.test(projectTypeLine)) projectType = 'vacation_rental';
  else if (/office|corporate|workspace/.test(projectTypeLine)) projectType = 'office';

  const pieceField = get('Target Pieces') || get('Pieces') || get('Target') || get('How many');
  let targetPieceCount = null;
  if (pieceField) {
    const n = pieceField.match(/(\d+)/);
    if (n) targetPieceCount = parseInt(n[1]);
  }

  const fullLower = text.toLowerCase();

  const styleMap = {
    music: /music|jazz|blues|rock|vinyl|instrument|guitar|piano|trumpet|saxophone|musician|album|concert/,
    abstract: /abstract|geometric|expressionist|surreal/,
    photography: /photo|photograph/,
    illustration: /illustrat|drawing|sketch/,
    vintage: /vintage|retro|antique|old.?school/,
    modern: /modern|contemporary|minimal/,
    coastal: /coastal|beach|ocean|nautical|wave|surf/,
    dramatic: /dramatic|bold|moody|dark|statement/,
    urban: /urban|city|street|industrial|skyline/,
    southern: /southern|rustic|farmhouse|country|boho|bohemian/,
  };
  const paletteMap = {
    purple: /purple|violet|lavender|plum/,
    blue: /blue|navy|teal|indigo/,
    green: /green|sage|olive|emerald/,
    black: /black|dark|charcoal/,
    metallic: /gold|silver|metallic|brass/,
    red: /red|crimson|burgundy/,
    orange: /orange|terracotta|rust|amber/,
    neutral: /neutral|beige|cream|ivory/,
    warm: /warm|earthy|earth.?tone/,
  };

  const styleTags = Object.entries(styleMap).filter(([, re]) => re.test(fullLower)).map(([k]) => k);
  const paletteTags = Object.entries(paletteMap).filter(([, re]) => re.test(fullLower)).map(([k]) => k);

  const avoidRaw = (get('Avoid') || get('What to avoid') || get('Please avoid') || '').toLowerCase();
  const avoidMap = {
    light: /light|airy|pastel|bright/,
    floral: /floral|flower|botanical/,
    kids: /kids|children|cartoon/,
    landscape: /landscape|nature|scenery/,
    typography: /typography|text|quotes|lettering/,
    dark: /dark|moody|skulls/,
  };
  const avoidTags = Object.entries(avoidMap).filter(([, re]) => re.test(avoidRaw)).map(([k]) => k);

  const galleryField = (get('Gallery Wall') || '').toLowerCase();
  const galleryWall = galleryField.includes('yes') || fullLower.includes('gallery wall');

  const briefSummary = `${projectType} project seeking ${styleTags.join(', ')} wall art in ${paletteTags.join(', ')} tones.`;

  return {
    projectName, clientName, location, projectType,
    styleTags, paletteTags, avoidTags, galleryWall,
    targetPieceCount, rooms: [],
    keyThemes: styleTags.slice(0, 3),
    searchKeywords: [...styleTags, ...paletteTags],
    briefSummary
  };
}

function defaultBrief() {
  return {
    projectName: '', clientName: '', location: '',
    projectType: 'other', styleTags: [], paletteTags: [],
    avoidTags: [], galleryWall: false, targetPieceCount: null,
    rooms: [], keyThemes: [], searchKeywords: [], briefSummary: ''
  };
}

// âââ Catalog tagging ââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
function tagRecord(r) {
  const text = `${r.title || ''} ${r.image_alt || ''} ${r.source_collection || ''} ${r.product_handle || ''}`.toLowerCase();

  const style = [];
  const palette = [];

  if (/jazz|blues|rock|hip.?hop|music|band|concert|vinyl|instrument|guitar|piano|trumpet|saxophone|drum|melody|musician|album|lyric|rhythm|record|boombox|microphone|turntable/.test(text)) style.push('music');
  if (/abstract|geometric|expressionist|generative|surreal/.test(text)) style.push('abstract');
  if (/photo|photograph/.test(text)) style.push('photography');
  if (/illustrat|drawing|sketch/.test(text)) style.push('illustration');
  if (/vintage|retro|antique|old.?school/.test(text)) style.push('vintage');
  if (/modern|contemporary|minimal/.test(text)) style.push('modern');
  if (/coastal|beach|ocean|nautical|wave|surf|sea/.test(text)) style.push('coastal');
  if (/floral|flower|botanical|garden|bloom/.test(text)) style.push('floral');
  if (/landscape|mountain|forest|nature|scenic/.test(text)) style.push('landscape');
  if (/typography|lettering|quote|word|phrase/.test(text)) style.push('typography');
  if (/city|urban|street|skyline|downtown/.test(text)) style.push('urban');
  if (/animal|cat|dog|bird|wildlife|fox|wolf|bear|deer/.test(text)) style.push('animal');
  if (/dark|moody|noir|dramatic|bold|gritty/.test(text)) style.push('dramatic');
  if (/southern|rustic|farmhouse|country|boho|bohemian/.test(text)) style.push('southern');
  if (/watercolor|pastel|soft|airy|light|bright|spring/.test(text)) style.push('light');

  if (/purple|violet|lavender|plum|amethyst/.test(text)) palette.push('purple');
  if (/blue|navy|teal|indigo|cobalt/.test(text)) palette.push('blue');
  if (/green|sage|olive|forest|emerald/.test(text)) palette.push('green');
  if (/black|dark|charcoal|ebony|noir|onyx/.test(text)) palette.push('black');
  if (/gold|silver|metallic|brass|bronze|gilded/.test(text)) palette.push('metallic');
  if (/red|crimson|burgundy|wine|maroon/.test(text)) palette.push('red');
  if (/orange|terracotta|rust|amber|burnt/.test(text)) palette.push('orange');
  if (/pink|blush|rose|coral|magenta/.test(text)) palette.push('pink');
  if (/neutral|beige|ivory|cream|tan|linen/.test(text)) palette.push('neutral');
  if (/warm|earthy|earth.?tone|sienna|ochre/.test(text)) palette.push('warm');

  return { ...r, style, palette };
}

// âââ Full-catalog scoring (runs on every record) ââââââââââââââââââââââââââââ
function scoreRecord(r, brief) {
  let score = 0;
  const text = `${r.title || ''} ${r.image_alt || ''} ${r.product_handle || ''}`.toLowerCase();
  const style = r.style || [];
  const palette = r.palette || [];

  // Style tag matches (+3 each)
  for (const s of brief.styleTags || []) {
    if (style.includes(s)) score += 3;
  }

  // Palette matches (+2 each)
  for (const p of brief.paletteTags || []) {
    if (palette.includes(p)) score += 2;
  }

  // searchKeywords â specific words like "jazz", "saxophone", "vinyl"
  // that directly match catalog text â most precise signal
  for (const kw of brief.searchKeywords || []) {
    if (kw.length >= 3 && text.includes(kw.toLowerCase())) score += 4;
  }

  // keyThemes phrase matching â split each theme into words
  for (const theme of brief.keyThemes || []) {
    for (const word of theme.toLowerCase().split(/\s+/).filter(w => w.length >= 4)) {
      if (text.includes(word)) score += 2;
    }
  }

  // Hard penalize avoid tags
  for (const a of brief.avoidTags || []) {
    if (style.includes(a) || text.includes(a)) score -= 8;
  }

  // Small boost for best-selling collections
  if (r.source_collection?.includes('best-selling')) score += 1;

  return score;
}

function normalizeUrl(r) {
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

// âââ Route Handler ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
export async function POST(request) {
  try {
    let briefText = '';
    let moodboardUrl = '';
    let refineFeedback = '';
    let prevItemTitles = [];
    let pinnedUrls = [];

    const contentType = request.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      briefText = formData.get('brief') || '';
      moodboardUrl = formData.get('moodboardUrl') || '';
      refineFeedback = formData.get('refineFeedback') || '';
      try { prevItemTitles = JSON.parse(formData.get('prevItemTitles') || '[]'); } catch {}
      try { pinnedUrls = JSON.parse(formData.get('pinnedUrls') || '[]'); } catch {}

      const file = formData.get('moodboard');
      if (file && file.size > 0) {
        try {
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('PDF timeout')), 4000));
          const pdfPromise = (async () => {
            const pdfParse = (await import('pdf-parse')).default;
            const data = await pdfParse(Buffer.from(await file.arrayBuffer()));
            return data.text || '';
          })();
          const pdfText = await Promise.race([pdfPromise, timeoutPromise]);
          if (pdfText) briefText += `\n\n--- MOODBOARD NOTES ---\n${pdfText}`;
        } catch (e) {
          console.warn('PDF skip:', e.message);
        }
      }
    } else {
      const body = await request.json();
      briefText = body.brief || '';
      moodboardUrl = body.moodboardUrl || '';
      refineFeedback = body.refineFeedback || '';
      prevItemTitles = body.prevItemTitles || [];
      pinnedUrls = body.pinnedUrls || [];
    }

    const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;
    const store = getStore('catalog');

    const raw = await store.get('records', { type: 'text' });
    if (!raw) {
      return NextResponse.json(
        { error: 'No catalog loaded. Please upload your catalog first via /catalog.' },
        { status: 400 }
      );
    }

    let allRecords;
    try {
      allRecords = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: 'Catalog data corrupted.' }, { status: 500 });
    }

    // ââ Stage 1: Parse brief ââââââââââââââââââââââââââââââââââââââââââââââââ
    let brief;
    if (hasAnthropicKey) {
      try {
        brief = await parseBriefWithClaude(briefText);
        brief.parsedBy = 'claude';
        if (!brief.searchKeywords)
          brief.searchKeywords = [...(brief.styleTags || []), ...(brief.paletteTags || [])];
      } catch (e) {
        console.warn('Claude brief parse failed, using fallback:', e.message);
        brief = parseBriefFallback(briefText);
        brief.parsedBy = 'regex-fallback';
      }
    } else {
      brief = parseBriefFallback(briefText);
      brief.parsedBy = 'regex';
    }

    // ââ Score the ENTIRE catalog ââââââââââââââââââââââââââââââââââââââââââââ
    // Tag every record, score every record â no sampling, no random cutoffs.
    // This ensures no good match gets missed regardless of catalog size.
    const tagged = allRecords.map(tagRecord);
    const scored = tagged
      .map(r => ({ ...r, _score: scoreRecord(r, brief) }))
      .filter(r => r._score > -3)  // only cut truly avoided items
      .sort((a, b) => b._score - a._score);

    // ââ Deduplicate by artwork family âââââââââââââââââââââââââââââââââââââââ
    const seen = new Set();
    const candidates = [];
    for (const r of scored) {
      const key = (r.product_handle || '').replace(/-\d+$/, '');
      if (!seen.has(key)) {
        seen.add(key);
        candidates.push(normalizeUrl(r));
        if (candidates.length >= 200) break;  // top 200 unique for Claude
      }
    }

    // ââ Stage 2: Claude selects the actual artworks âââââââââââââââââââââââââ
    let primary = [];
    let accent = [];

    if (hasAnthropicKey && candidates.length > 0) {
      try {
        const primarySelections = await selectWithClaude(
          candidates, brief, prevItemTitles, refineFeedback
        );
        const primaryHandles = new Map(
          primarySelections.map(s => [s.handle, s.reason])
        );

        primary = candidates
          .filter(c => primaryHandles.has(c.product_handle))
          .map(c => ({ ...c, reason: primaryHandles.get(c.product_handle) }));

        // If Claude returned fewer than expected, fill with top-scored candidates
        if (primary.length < 15) {
          const usedHandles = new Set(primary.map(r => r.product_handle));
          const fill = candidates
            .filter(r => !usedHandles.has(r.product_handle))
            .slice(0, 20 - primary.length);
          primary.push(...fill);
        }

        // Accent: top remaining scored candidates not in primary
        const primarySet = new Set(primary.map(r => r.product_handle));
        accent = candidates
          .filter(r => !primarySet.has(r.product_handle))
          .slice(0, 15);
      } catch (e) {
        console.warn('Claude selection failed, using keyword results:', e.message);
        primary = candidates.slice(0, 20);
        accent = candidates.slice(20, 35);
      }
    } else {
      // No API key: use keyword-scored candidates directly
      primary = candidates.slice(0, 20);
      accent = candidates.slice(20, 35);
    }

    // ââ Pinned items (force-include specific Society6 URLs) âââââââââââââââââ
    const pinnedRecords = [];
    if (pinnedUrls.length > 0) {
      for (const url of pinnedUrls) {
        const handle = url.split('/products/')[1]?.split('?')[0]?.split('/')[0];
        if (!handle) continue;
        const found = allRecords.find(r =>
          r.product_handle === handle || (r.product_url || '').includes(handle)
        );
        if (found) pinnedRecords.push({ ...normalizeUrl(tagRecord(found)), pinned: true });
      }
    }

    if (pinnedRecords.length > 0) {
      const pinnedSet = new Set(pinnedRecords.map(r => r.product_url));
      primary = [...pinnedRecords, ...primary.filter(r => !pinnedSet.has(r.product_url))];
    }

    // ââ Gallery wall sets âââââââââââââââââââââââââââââââââââââââââââââââââââ
    const galleryWallSets = brief.galleryWall ? [
      {
        setNumber: 1,
        theme: (brief.keyThemes || [])[0] || 'curated',
        items: primary.slice(0, 6)
      },
      {
        setNumber: 2,
        theme: (brief.keyThemes || [])[1] || 'accent',
        items: primary.slice(6, 12)
      },
    ] : [];

    return NextResponse.json({
      brief,
      primary: primary.slice(0, 20),
      accent: accent.slice(0, 15),
      galleryWallSets,
      totalScored: scored.length,
      catalogSize: allRecords.length,
      aiPowered: hasAnthropicKey,
    });
  } catch (err) {
    console.error('Recommend error:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to generate recommendations' },
      { status: 500 }
    );
  }
}
