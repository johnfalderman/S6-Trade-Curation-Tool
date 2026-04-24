import { NextResponse } from 'next/server';
import { getStore } from '@netlify/blobs';

// ——— Stage 1: Claude parses the brief into structured data ———————————————
async function parseBriefWithClaude(text) {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: `You are an interior design trade art curation assistant. Parse this Jotform curation brief into structured JSON.

The brief may be in any format — a direct form response, a copied email, a freeform description, or a structured list.

BRIEF TEXT:
${text}

Return ONLY valid JSON (no markdown, no explanation) with exactly these fields:
{
  "projectName": "look for 'Design Project', 'Design Project Name', or 'Project Name' label. Use value exactly, or empty string.",
  "clientName": "look for 'Company Name', 'Client Name', 'Property Name', 'Business Name', or 'Company' label. Use value exactly.",
  "location": "city and state/country (look for Location, City, Address, or any geographic reference)",
  "projectType": "hotel|restaurant|vacation_rental|office|other",
  "styleTags": ["art style keywords — e.g. modern, vintage, abstract, photography, coastal, dramatic, music, urban, bohemian, minimalist, rustic"],
  "paletteTags": ["color keywords — e.g. purple, dark, blue, neutral, green, warm, black, metallic, earthy, red"],
  "avoidTags": ["things to explicitly avoid — e.g. floral, kids, landscape, typography, abstract, dark, bright, pastel"],
  "galleryWall": true or false,
  "targetPieceCount": number or null,
  "keyThemes": ["3-6 short vibe phrases — e.g. 'jazz club atmosphere', 'coastal modern', 'dark moody', 'music venue', 'southern charm'"],
  "rooms": ["room types mentioned"],
  "searchKeywords": ["15-25 individual words that describe artwork fitting this brief — very specific words like 'saxophone', 'vinyl', 'turntable', 'cobalt', 'terracotta', 'geometric' — that would match artwork titles or descriptions"],
  "subjectMustMatch": ["the 2-5 PRIMARY subject categories this brief is about — e.g. 'music', 'urban', 'coastal'. These are the non-negotiable themes. An artwork that doesn't relate to ANY of these subjects is a bad recommendation, even if the colors and mood are right."],
  "briefSummary": "2-3 sentence plain English summary of what this client needs"
}`
    }]
  });

  let jsonStr = message.content[0].text.trim();
  // Strip any accidental markdown fences — Haiku sometimes wraps JSON
  jsonStr = jsonStr.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '');
  return JSON.parse(jsonStr);
}

// ——— Feedback parsing: turn freeform refinement text into structured hints ———
// Without this, "gritty cityscapes" just appears in the final prompt but
// the candidate pool is still scored against the original brief. By extracting
// add/avoid keywords from feedback, we reshape the pool itself.
async function parseFeedbackWithClaude(feedback) {
  if (!feedback || !feedback.trim()) return { addKeywords: [], avoidKeywords: [], tone: '' };
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 400,
    messages: [{
      role: 'user',
      content: `A client is refining art recommendations. Parse their feedback into structured hints.

FEEDBACK: "${feedback}"

Valid subject categories: music, coastal, floral, landscape, urban, animal, southern, typography, abstract.

Return ONLY valid JSON (no markdown) with:
{
  "addKeywords": ["concrete words that should appear in matching artwork titles/descriptions — e.g. 'gritty', 'cityscape', 'skyline', 'industrial', 'concrete', 'alleyway'. Include synonyms and related concrete subjects. 6-15 words."],
  "avoidKeywords": ["words that would disqualify an artwork based on the feedback's tone or subject — if feedback says 'urban scenes', avoid 'mountain', 'forest', 'woodland', 'floral', 'beach', 'landscape'. If feedback says 'gritty', avoid 'cheerful', 'christmas', 'whimsical', 'pastel'. 4-12 words."],
  "subjectOverride": ["IF the feedback explicitly names a subject matter (like 'cityscapes', 'urban scenes', 'music art', 'coastal views'), return the matching subject categories from the list above. Otherwise return []. For 'urban scenes moody dark' return ['urban']. For 'more nature' return ['landscape']. For 'less nature more geometric' return ['abstract']."],
  "tone": "1 short phrase describing the overall mood shift"
}`
    }]
  });

  try {
    let raw = message.content[0].text.trim();
    raw = raw.replace(/^\`\`\`json?\s*/i, '').replace(/\s*\`\`\`$/i, '');
    const parsed = JSON.parse(raw);
    return {
      addKeywords: Array.isArray(parsed.addKeywords) ? parsed.addKeywords : [],
      avoidKeywords: Array.isArray(parsed.avoidKeywords) ? parsed.avoidKeywords : [],
      subjectOverride: Array.isArray(parsed.subjectOverride) ? parsed.subjectOverride : [],
      tone: parsed.tone || ''
    };
  } catch {
    return { addKeywords: [], avoidKeywords: [], subjectOverride: [], tone: '' };
  }
}

// ——— Stage 2: Claude selects the best artworks from candidates ——————————————
async function selectWithClaude(candidates, brief, prevItemTitles = [], feedback = '') {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // CHANGE 2: Include style + palette tags so Claude has richer context
  const catalogList = candidates.slice(0, 200).map((r, i) =>
    `${i}|${r.title}|${r.source_collection}|${r.product_handle}|styles:${(r.style||[]).join(',')}|palette:${(r.palette||[]).join(',')}`
  ).join('\n');

  const hasFeedback = (feedback || '').trim().length > 0;
  const hasPrev = prevItemTitles.length > 0;
  let refinementContext = '';
  if (hasFeedback || hasPrev) {
    const parts = ['\n=== REFINEMENT REQUEST ==='];
    if (hasFeedback) {
      parts.push(`CLIENT FEEDBACK (this is the MOST IMPORTANT instruction — your selection MUST directly reflect it): "${feedback}"`);
    }
    if (hasPrev) {
      parts.push(`PREVIOUSLY SHOWN TO CLIENT (do NOT repeat these titles):\n${prevItemTitles.slice(0, 40).join('\n')}`);
    }
    parts.push('Select artworks that concretely act on the client feedback above. If the feedback says "less X, more Y", your picks must noticeably shift away from X and toward Y compared to before. Do not return items that are essentially the same vibe as what was previously shown.');
    refinementContext = parts.join('\n');
  }

  const avoidLine = (brief.avoidTags || []).length > 0
    ? `Avoid anything with these qualities: ${brief.avoidTags.join(', ')}.`
    : '';

  const subjectLine = (brief.subjectMustMatch || brief.styleTags || []).length > 0
    ? `CRITICAL — The primary subject matter for this project is: ${(brief.subjectMustMatch || brief.styleTags || []).join(', ')}. Do NOT select artworks whose subject matter is unrelated to these themes, even if the colors or mood happen to match. For example, if the brief is about music/jazz, do not pick nature photography just because it's dark and moody.`
    : '';

  const prompt = `You are an expert art curator for Society6's trade program. You select wall art for interior designers, hotels, restaurants, and vacation rental owners. Your curation choices reflect genuine aesthetic judgment — not just keyword matching.

CLIENT BRIEF:
${brief.briefSummary || ''}
Project: ${brief.projectName || 'Trade Client'} (${brief.projectType || 'commercial'})
Style: ${(brief.styleTags || []).join(', ') || 'not specified'}
Palette: ${(brief.paletteTags || []).join(', ') || 'not specified'}
Themes: ${(brief.keyThemes || []).join(', ') || 'not specified'}
${subjectLine}
${avoidLine}
${refinementContext}

CATALOG OPTIONS (index|title|collection|handle|styles|palette):
${catalogList}

Your task: Select the 20 artworks that best serve this client. Think like a curator — consider:
- SUBJECT MATTER IS KING: Does the artwork's subject directly relate to the client's theme? A jazz club needs music art, not dark landscapes. A coastal hotel needs ocean art, not abstract geometry. Reject items where the subject is off-theme, even if colors match.
- Does the title/subject matter fit the space and mood?
- Do the style and palette tags align with what the client asked for?
- Does the artwork cohesively contribute to a curated set — not just 20 random good pieces?
- Does the collection source suggest the right medium (art print, canvas, etc.)?
${prevItemTitles.length > 0 ? '- The client has already seen the "previously shown" list — give them genuinely different options.' : ''}

Return ONLY a valid JSON array with no markdown or explanation:
[{"index": 0, "handle": "exact-product-handle", "reason": "one specific sentence explaining why this piece fits the brief"}]`;

  // CHANGE 3: Upgrade to Sonnet for better curatorial judgment
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

// ——— Find Similar: build a synthetic brief from seed product URLs ——————————
// The hybrid approach: aggregate tags from catalog matches (cheap, deterministic)
// then have Claude refine them into a full brief (catches nuance, expands keywords).
// Seeds that aren't in the catalog are still included as hints for Claude but
// don't contribute tags directly.
async function buildBriefFromSeeds(seedUrls, allRecords, hasAnthropicKey) {
  const handleOf = (url) => {
    if (!url) return null;
    const m = (url || '').match(/\/products\/([^?\/#]+)/);
    return m ? m[1] : null;
  };

  const matchedSeeds = [];
  const unmatchedUrls = [];
  for (const url of seedUrls) {
    const handle = handleOf(url);
    if (!handle) { unmatchedUrls.push(url); continue; }
    const rec = allRecords.find(r =>
      r.product_handle === handle || (r.product_url || '').includes(handle)
    );
    if (rec) matchedSeeds.push(tagRecord(rec));
    else unmatchedUrls.push(url);
  }

  // Aggregate tag frequencies from matched seeds
  const tagCount = (field) => {
    const counts = {};
    for (const s of matchedSeeds) {
      for (const tag of s[field] || []) counts[tag] = (counts[tag] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([t]) => t);
  };
  const seedStyles = tagCount('style');
  const seedPalette = tagCount('palette');
  const seedSubjects = seedStyles.filter(s => SUBJECT_TAGS.includes(s));

  // Tag-only baseline brief — used if Claude unavailable
  const baselineBrief = {
    projectName: 'Find Similar',
    clientName: '',
    location: '',
    projectType: 'other',
    styleTags: seedStyles.slice(0, 6),
    paletteTags: seedPalette.slice(0, 6),
    avoidTags: [],
    galleryWall: false,
    targetPieceCount: null,
    rooms: [],
    keyThemes: seedStyles.slice(0, 3),
    searchKeywords: Array.from(new Set([
      ...seedStyles,
      ...seedPalette,
      // Pull meaningful words from seed titles as extra scoring signal
      ...matchedSeeds.flatMap(s => (s.title || '').toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length >= 4 && !['print','canvas','wood','framed','mini','metal','acrylic'].includes(w))
      ),
    ])).slice(0, 25),
    subjectMustMatch: seedSubjects,
    briefSummary: `Find artwork similar to ${matchedSeeds.length} seed product(s).`,
    parsedBy: 'tag-aggregate',
    findSimilarSeeds: matchedSeeds.length,
    findSimilarUnmatched: unmatchedUrls.length,
  };

  if (!hasAnthropicKey || matchedSeeds.length === 0) {
    return baselineBrief;
  }

  // Claude refinement pass — hybrid step 2
  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const seedList = matchedSeeds.slice(0, 20).map((s, i) =>
      `${i + 1}. ${s.title} | collection:${s.source_collection} | alt:${s.image_alt || ''} | styles:${(s.style||[]).join(',')} | palette:${(s.palette||[]).join(',')}`
    ).join('\n');
    const unmatchedList = unmatchedUrls.slice(0, 10).map(u => `- ${u}`).join('\n');

    const prompt = `You are an expert art curator. A user is in "find similar" mode — they've pasted Society6 product URLs and want recommendations of artwork with a similar aesthetic.

SEED PRODUCTS (matched in catalog):
${seedList}

${unmatchedList ? `SEED URLs (not in catalog — infer from slug):\n${unmatchedList}\n` : ''}

Aggregated seed tags:
- Styles seen: ${seedStyles.join(', ') || 'none'}
- Palette seen: ${seedPalette.join(', ') || 'none'}
- Subjects: ${seedSubjects.join(', ') || 'none'}

Your job: synthesize a brief that captures the common aesthetic thread across these seeds. Go deeper than the raw tags — identify the underlying vibe (e.g. "moody urban photography with warm neutrals" vs. just "urban, warm").

Return ONLY valid JSON (no markdown, no explanation) with exactly these fields:
{
  "styleTags": ["art style keywords reflecting the shared aesthetic — e.g. modern, vintage, abstract, photography, coastal, dramatic, music, urban, bohemian, minimalist, rustic, floral, landscape"],
  "paletteTags": ["color keywords — e.g. purple, dark, blue, neutral, green, warm, black, metallic, earthy, red, pink, orange"],
  "avoidTags": ["qualities that would clash with the seed aesthetic"],
  "keyThemes": ["3-6 short vibe phrases describing the shared mood"],
  "searchKeywords": ["15-25 concrete words that would appear in similar artwork titles/descriptions — specific things like 'saxophone', 'cobalt', 'terracotta', 'geometric'"],
  "subjectMustMatch": ["the 1-4 PRIMARY subject categories (from: music, coastal, floral, landscape, urban, animal, southern, typography, abstract). If the seeds are all music-themed, this is ['music']. If mixed, include each."],
  "briefSummary": "2-3 sentence plain English summary of the aesthetic this user is looking for"
}`;

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }]
    });

    let raw = message.content[0].text.trim();
    raw = raw.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '');
    const refined = JSON.parse(raw);

    return {
      ...baselineBrief,
      styleTags: Array.isArray(refined.styleTags) ? refined.styleTags : baselineBrief.styleTags,
      paletteTags: Array.isArray(refined.paletteTags) ? refined.paletteTags : baselineBrief.paletteTags,
      avoidTags: Array.isArray(refined.avoidTags) ? refined.avoidTags : [],
      keyThemes: Array.isArray(refined.keyThemes) ? refined.keyThemes : baselineBrief.keyThemes,
      searchKeywords: Array.isArray(refined.searchKeywords) ? refined.searchKeywords : baselineBrief.searchKeywords,
      subjectMustMatch: Array.isArray(refined.subjectMustMatch)
        ? refined.subjectMustMatch.filter(s => SUBJECT_TAGS.includes((s || '').toLowerCase()))
        : baselineBrief.subjectMustMatch,
      briefSummary: refined.briefSummary || baselineBrief.briefSummary,
      parsedBy: 'find-similar-claude',
    };
  } catch (e) {
    console.warn('Find Similar Claude refinement failed, using tag-only brief:', e.message);
    return baselineBrief;
  }
}

// Merge two briefs by taking the union of list fields. The "primary" brief's
// scalar fields (projectName, clientName, briefSummary) win. Used when user
// provides BOTH a Jotform brief AND find-similar URLs.
function mergeBriefs(primary, supplemental) {
  if (!primary) return supplemental;
  if (!supplemental) return primary;
  const unionList = (a = [], b = []) => Array.from(new Set([...(a || []), ...(b || [])]));
  return {
    ...primary,
    styleTags: unionList(primary.styleTags, supplemental.styleTags),
    paletteTags: unionList(primary.paletteTags, supplemental.paletteTags),
    avoidTags: unionList(primary.avoidTags, supplemental.avoidTags),
    keyThemes: unionList(primary.keyThemes, supplemental.keyThemes),
    searchKeywords: unionList(primary.searchKeywords, supplemental.searchKeywords),
    subjectMustMatch: unionList(primary.subjectMustMatch, supplemental.subjectMustMatch),
    rooms: unionList(primary.rooms, supplemental.rooms),
    parsedBy: `${primary.parsedBy || 'unknown'}+${supplemental.parsedBy || 'unknown'}`,
  };
}

// ——— Regex Brief Parser (fallback when no API key) ———————————————————————
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
    southern: /\b(southern|rustic|farmhouse|boho|bohemian)\b/,
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
    subjectMustMatch: styleTags.filter(s => !['dramatic', 'modern', 'vintage'].includes(s)),
    briefSummary
  };
}

function defaultBrief() {
  return {
    projectName: '', clientName: '', location: '',
    projectType: 'other', styleTags: [], paletteTags: [],
    avoidTags: [], galleryWall: false, targetPieceCount: null,
    rooms: [], keyThemes: [], searchKeywords: [],
    subjectMustMatch: [], briefSummary: ''
  };
}

// ——— Catalog tagging ——————————————————————————————————————————————————————
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
  if (/floral|flower|botanical|garden|bloom|peon(y|ies)|tulip|rose|anemone|lily|daisy|orchid|bouquet|blossom/.test(text)) style.push('floral');
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

// ——— Subject-matter categories for mismatch detection ————————————————————
// These are "concrete subject" tags. Mood/aesthetic tags like 'dramatic' and
// 'modern' are excluded because they describe HOW something looks, not WHAT
// the artwork depicts.
const SUBJECT_TAGS = ['music', 'coastal', 'floral', 'landscape', 'urban', 'animal', 'southern', 'typography', 'abstract'];

// ——— Product type categorization —————————————————————————————————————————
// Maps a catalog record's source_collection to a coarse product category,
// used by the product-type filter UI (exclude wood / include pillows / wall
// prints only / posters only). Defensive against unexpected collection names.
function productCategory(sourceCollection) {
  const sc = (sourceCollection || '').toLowerCase().trim();
  if (!sc) return 'other';
  if (/throw.?pillow|\bpillow/.test(sc)) return 'pillow';
  if (/\bwood/.test(sc)) return 'wood';
  if (/poster/.test(sc)) return 'poster';
  // Paper prints: art-prints, framed-art-prints, mini-art-prints
  if (/(^|-)((mini|framed)-)?art-prints?(-|$)/.test(sc) || sc === 'art-prints') return 'wall-print';
  if (/canvas/.test(sc)) return 'canvas';
  if (/metal/.test(sc)) return 'metal';
  if (/acrylic/.test(sc)) return 'acrylic';
  if (/tapestry|tapestries|mural/.test(sc)) return 'other-wall-art';
  return 'other';
}

// Apply the user's product-type filters. Returns true if the record should
// remain in the candidate pool.
function passesProductFilters(record, filters) {
  if (!filters) return true;
  const cat = productCategory(record.source_collection);

  // Pillows are a separate product type. Opt-in only via includePillows toggle.
  // They bypass the wall-art format radio entirely.
  if (cat === 'pillow') return !!filters.includePillows;

  // Wall art handling ----
  if (cat === 'wood' && filters.excludeWood) return false;

  if (filters.wallArtMode === 'prints') return cat === 'wall-print';
  if (filters.wallArtMode === 'posters') return cat === 'poster';

  // 'all' (or unset): keep everything else that wasn't filtered out above
  return true;
}

// ——— Full-catalog scoring (runs on every record) ——————————————————————————
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

  // searchKeywords — specific words like "jazz", "saxophone", "vinyl"
  // that directly match catalog text — most precise signal
  for (const kw of brief.searchKeywords || []) {
    if (kw.length >= 3 && text.includes(kw.toLowerCase())) score += 4;
  }

  // keyThemes phrase matching — split each theme into words
  for (const theme of brief.keyThemes || []) {
    for (const word of theme.toLowerCase().split(/\s+/).filter(w => w.length >= 4)) {
      if (text.includes(word)) score += 2;
    }
  }

  // Hard penalize avoid tags
  for (const a of brief.avoidTags || []) {
    if (style.includes(a) || text.includes(a)) score -= 8;
  }

  // CHANGE 1: Subject-mismatch penalty
  // If the brief has specific subject requirements (e.g., "music"),
  // penalize items that have a DIFFERENT concrete subject tag but NOT
  // the required one. This prevents dark nature photos from sneaking
  // into a jazz brief just because they match on palette/mood.
  const requiredSubjects = brief.subjectMustMatch || [];
  if (requiredSubjects.length > 0) {
    const itemSubjects = style.filter(s => SUBJECT_TAGS.includes(s));
    const hasRequiredSubject = itemSubjects.some(s => requiredSubjects.includes(s));

    if (itemSubjects.length > 0 && !hasRequiredSubject) {
      // Item has a concrete subject (e.g. "landscape") that doesn't match
      // any required subject (e.g. "music") — penalize HARD so it drops
      // well below matching items even if colors/palette align
      score -= 15;
    } else if (hasRequiredSubject) {
      // Item matches a required subject — big bonus
      score += 8;
    }
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

// ——— Route Handler ————————————————————————————————————————————————————————
export async function POST(request) {
  try {
    let briefText = '';
    let moodboardUrl = '';
    let refineFeedback = '';
    let prevItemTitles = [];
    let pinnedUrls = [];
    let productFilters = null;
    let findSimilarUrls = [];

    const contentType = request.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      briefText = formData.get('brief') || '';
      moodboardUrl = formData.get('moodboardUrl') || '';
      refineFeedback = formData.get('refineFeedback') || '';
      try { prevItemTitles = JSON.parse(formData.get('prevItemTitles') || '[]'); } catch {}
      try { pinnedUrls = JSON.parse(formData.get('pinnedUrls') || '[]'); } catch {}
      try { productFilters = JSON.parse(formData.get('productFilters') || 'null'); } catch {}
      try { findSimilarUrls = JSON.parse(formData.get('findSimilarUrls') || '[]'); } catch {}

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
      productFilters = body.productFilters || null;
      findSimilarUrls = body.findSimilarUrls || [];
    }

    // Normalize findSimilarUrls: accept array or newline-separated string
    if (typeof findSimilarUrls === 'string') {
      findSimilarUrls = findSimilarUrls.split('\n').map(s => s.trim()).filter(Boolean);
    }
    findSimilarUrls = (Array.isArray(findSimilarUrls) ? findSimilarUrls : [])
      .map(u => (u || '').trim())
      .filter(Boolean);

    // —— Optional: fetch moodboard URL and append extracted text to brief ——
    // Best-effort only. ANY failure (timeout, bad URL, blocked scraper, parse
    // error, unexpected exception) is swallowed so the recommendation flow
    // continues unchanged. The extracted text is clearly labelled so Claude
    // can weigh it against the explicit Jotform answers rather than being
    // overridden by it.
    if (moodboardUrl && typeof moodboardUrl === 'string' && moodboardUrl.trim()) {
      try {
        let cleanUrl = moodboardUrl.trim();
        if (!/^https?:\/\//i.test(cleanUrl)) cleanUrl = 'https://' + cleanUrl;
        // Validate it parses as a URL before fetching.
        const _parsed = new URL(cleanUrl);
        const res = await fetch(cleanUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; S6TradeCurationBot/1.0)',
            'Accept': 'text/html,application/xhtml+xml',
          },
          signal: AbortSignal.timeout(4000),
          redirect: 'follow',
        });
        if (res.ok) {
          const ctype = (res.headers.get('content-type') || '').toLowerCase();
          if (ctype.includes('text/html') || ctype.includes('application/xhtml')) {
            // Cap body read at ~500KB so a huge page can't blow up memory.
            const rawHtml = (await res.text()).slice(0, 500_000);

            const pick = (re) => {
              const m = rawHtml.match(re);
              return m ? m[1].trim() : '';
            };
            const decode = (s) => s
              .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
              .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');

            const title       = decode(pick(/<title[^>]*>([\s\S]*?)<\/title>/i));
            const metaDesc    = decode(pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i));
            const ogTitle     = decode(pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i));
            const ogDesc      = decode(pick(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i));
            const ogSiteName  = decode(pick(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i));
            const twitterDesc = decode(pick(/<meta[^>]+name=["']twitter:description["'][^>]+content=["']([^"']+)["']/i));

            // Collect up to 25 alt texts (good signal on Pinterest/Houzz boards).
            const alts = [];
            const altRe = /<img[^>]+alt=["']([^"']{3,120})["']/gi;
            let am;
            while ((am = altRe.exec(rawHtml)) !== null && alts.length < 25) {
              const a = decode(am[1]).trim();
              if (a && !/^(image|photo|picture|logo|icon)$/i.test(a)) alts.push(a);
            }

            const lines = [
              ogSiteName && `Source: ${ogSiteName}`,
              (ogTitle || title) && `Title: ${ogTitle || title}`,
              (ogDesc || metaDesc || twitterDesc) && `Description: ${ogDesc || metaDesc || twitterDesc}`,
              alts.length && `Image captions: ${alts.join(' | ')}`,
            ].filter(Boolean);

            // Only append if we actually extracted something useful.
            const extracted = lines.join('\n').slice(0, 3000);
            if (extracted.trim().length > 20) {
              briefText += `\n\n--- MOODBOARD URL NOTES (source: ${cleanUrl}) ---\n${extracted}\n--- END MOODBOARD URL NOTES (treat as supplemental inspiration; Jotform answers take precedence if they conflict) ---`;
            } else {
              console.warn('Moodboard URL: no useful metadata extracted, skipping.');
            }
          } else {
            console.warn('Moodboard URL: non-HTML content-type, skipping:', ctype);
          }
        } else {
          console.warn('Moodboard URL: fetch returned', res.status);
        }
      } catch (e) {
        // Swallow everything — never let a bad moodboard URL break recommendations.
        console.warn('Moodboard URL skip:', e && e.message ? e.message : e);
      }
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

    // —— Catalog breakdown by product category (pre-filter) ————————————————
    // Computed on the full catalog so the UI can warn users when a filter
    // they enabled has zero matching records (e.g., "Include throw pillows"
    // against a wall-art-only catalog).
    const catalogBreakdown = {
      wallPrint: 0,
      poster: 0,
      canvas: 0,
      wood: 0,
      metal: 0,
      acrylic: 0,
      otherWallArt: 0,
      pillow: 0,
      other: 0,
    };
    for (const r of allRecords) {
      const cat = productCategory(r.source_collection);
      if (cat === 'wall-print') catalogBreakdown.wallPrint++;
      else if (cat === 'poster') catalogBreakdown.poster++;
      else if (cat === 'canvas') catalogBreakdown.canvas++;
      else if (cat === 'wood') catalogBreakdown.wood++;
      else if (cat === 'metal') catalogBreakdown.metal++;
      else if (cat === 'acrylic') catalogBreakdown.acrylic++;
      else if (cat === 'other-wall-art') catalogBreakdown.otherWallArt++;
      else if (cat === 'pillow') catalogBreakdown.pillow++;
      else catalogBreakdown.other++;
    }

    // —— Product type filter (applied BEFORE tagging/scoring so the pool shrinks)
    const totalBeforeFilter = allRecords.length;
    if (productFilters) {
      allRecords = allRecords.filter(r => passesProductFilters(r, productFilters));
    } else {
      // Default behavior when the client doesn't send filters: still exclude
      // pillows so legacy clients keep their wall-art-only experience.
      allRecords = allRecords.filter(r => productCategory(r.source_collection) !== 'pillow');
    }
    const totalAfterFilter = allRecords.length;
    if (totalAfterFilter === 0) {
      return NextResponse.json({
        error: 'No catalog items match the selected product types. Try loosening the Product Types filter.',
        catalogBreakdown,
        catalogSize: totalBeforeFilter,
      }, { status: 400 });
    }

    // Must have at least one signal: a brief, or find-similar seed URLs
    const hasBriefText = !!(briefText || '').trim();
    const hasSeeds = findSimilarUrls.length > 0;
    if (!hasBriefText && !hasSeeds) {
      return NextResponse.json({
        error: 'Please provide either a Jotform brief or at least one Society6 product URL in Find Similar.',
      }, { status: 400 });
    }

    // —— Stage 1: Parse brief ——————————————————————————————————————————————
    let brief = null;
    if (hasBriefText) {
      if (hasAnthropicKey) {
        try {
          brief = await parseBriefWithClaude(briefText);
          brief.parsedBy = 'claude';
          if (!brief.searchKeywords)
            brief.searchKeywords = [...(brief.styleTags || []), ...(brief.paletteTags || [])];
          if (!brief.subjectMustMatch)
            brief.subjectMustMatch = (brief.styleTags || []).filter(s => SUBJECT_TAGS.includes(s));
        } catch (e) {
          console.warn('Claude brief parse failed, using fallback:', e.message);
          brief = parseBriefFallback(briefText);
          brief.parsedBy = 'regex-fallback';
        }
      } else {
        brief = parseBriefFallback(briefText);
        brief.parsedBy = 'regex';
      }
    }

    // —— Find Similar: build (or merge in) a synthetic brief from seed URLs ——
    if (hasSeeds) {
      const synthBrief = await buildBriefFromSeeds(findSimilarUrls, allRecords, hasAnthropicKey);
      if (brief) {
        // Brief + seeds — combine signals
        brief = mergeBriefs(brief, synthBrief);
        brief.findSimilarSeeds = synthBrief.findSimilarSeeds;
        brief.findSimilarUnmatched = synthBrief.findSimilarUnmatched;
      } else {
        // Seed-only mode — the synth brief IS the brief
        brief = synthBrief;
      }
      // Auto-include the seed URLs as pinned so the originals surface in results
      const seedPinSet = new Set(pinnedUrls || []);
      for (const u of findSimilarUrls) seedPinSet.add(u);
      pinnedUrls = Array.from(seedPinSet);
    }

    if (productFilters) {
      console.log('[recommend] product filter applied:', JSON.stringify(productFilters),
        `| catalog ${totalBeforeFilter} -> ${totalAfterFilter}`);
    }

    // —— Feedback-aware brief augmentation ————————————————————————————————
    // When the user refines with something like "gritty cityscapes", we parse
    // that feedback into add/avoid keywords and merge into the brief so the
    // *scoring stage* shifts the candidate pool, not just the final prompt.
    let feedbackHints = { addKeywords: [], avoidKeywords: [], subjectOverride: [], tone: '' };
    if (refineFeedback && refineFeedback.trim() && hasAnthropicKey) {
      try {
        feedbackHints = await parseFeedbackWithClaude(refineFeedback);
        console.log('[recommend] feedbackHints:', JSON.stringify(feedbackHints));
      } catch (e) {
        console.warn('Feedback parse failed:', e.message);
      }
      // If the feedback names an explicit subject ('urban', 'landscape', etc.),
      // REPLACE the original subjectMustMatch with it. This is the strongest
      // lever we have — items with a non-matching concrete subject get a
      // -15 penalty in scoring, which effectively removes them from the pool.
      const newSubjects = (feedbackHints.subjectOverride || [])
        .map(s => (s || '').toLowerCase().trim())
        .filter(s => SUBJECT_TAGS.includes(s));
      brief = {
        ...brief,
        searchKeywords: Array.from(new Set([...(brief.searchKeywords || []), ...feedbackHints.addKeywords])),
        avoidTags: Array.from(new Set([...(brief.avoidTags || []), ...feedbackHints.avoidKeywords])),
        subjectMustMatch: newSubjects.length > 0 ? newSubjects : (brief.subjectMustMatch || []),
      };
    }

    // —— Score the ENTIRE catalog ——————————————————————————————————————————
    // Tag every record, score every record — no sampling, no random cutoffs.
    // This ensures no good match gets missed regardless of catalog size.
    const tagged = allRecords.map(tagRecord);
    const scored = tagged
      .map(r => ({ ...r, _score: scoreRecord(r, brief) }))
      .filter(r => r._score > -3)  // only cut truly avoided items
      .sort((a, b) => b._score - a._score);

    // —— Deduplicate by artwork family —————————————————————————————————————
    // Also filter out items previously shown to the client during refinement,
    // so Claude sees a fresh candidate pool and can actually pick different art.
    const prevTitleSet = new Set(
      (prevItemTitles || []).map(t => (t || '').toLowerCase().trim()).filter(Boolean)
    );
    // Collapse format variants: the same artwork appears as "Art Print",
    // "Framed Art Print", "Canvas Print", etc. Strip those suffixes from the
    // title to make a single family key, then also dedupe on the handle stem.
    const familyKey = (r) => {
      const t = (r.title || '')
        .toLowerCase()
        .replace(/\s*(framed\s+art\s+print|canvas\s+print|wood\s+wall\s+art|art\s+print|mini\s+art\s+print|metal\s+print|acrylic\s+block|wall\s+tapestry|poster|mural)\s*$/i, '')
        .replace(/[\s\W_]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .trim();
      const h = (r.product_handle || '')
        .replace(/-(framed|canvas|wood|metal|acrylic|mini|poster|tapestry|mural)(-.*)?$/i, '')
        .replace(/-\d+$/, '');
      return t || h;
    };

    const seen = new Set();
    const candidates = [];
    for (const r of scored) {
      const key = familyKey(r);
      if (seen.has(key)) continue;
      if (prevTitleSet.size > 0 && prevTitleSet.has((r.title || '').toLowerCase().trim())) continue;
      seen.add(key);
      candidates.push(normalizeUrl(r));
      if (candidates.length >= 200) break;  // top 200 unique for Claude
    }

    // —— Stage 2: Claude selects the actual artworks ———————————————————————
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

    // —— Pinned items (force-include specific Society6 URLs) ———————————————
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

    // —— Gallery wall sets —————————————————————————————————————————————————
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
      catalogSize: totalBeforeFilter,
      filteredSize: totalAfterFilter,
      catalogBreakdown,
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
