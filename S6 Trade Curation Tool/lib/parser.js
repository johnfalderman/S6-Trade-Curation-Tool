/**
 * parser.js
 * Converts pasted Jotform submission text into a normalized brief object.
 * Rule-based — no LLM required.
 */

const PROJECT_TYPE_MAP = {
  hotel: 'hotel',
  motel: 'hotel',
  inn: 'hotel',
  resort: 'hotel',
  restaurant: 'restaurant',
  cafe: 'restaurant',
  bar: 'restaurant',
  eatery: 'restaurant',
  'vacation rental': 'vacation_rental',
  vrbo: 'vacation_rental',
  airbnb: 'vacation_rental',
  'short-term rental': 'vacation_rental',
  rental: 'vacation_rental',
  office: 'office',
  corporate: 'office',
  workspace: 'office',
  coworking: 'office',
  spa: 'other',
  clinic: 'other',
  retail: 'other',
};

const STYLE_KEYWORDS = [
  'modern', 'contemporary', 'minimalist', 'minimal', 'clean',
  'vintage', 'retro', 'mid-century', 'midcentury', 'antique',
  'coastal', 'beach', 'nautical', 'ocean', 'tropical',
  'southern', 'rustic', 'farmhouse', 'bohemian', 'boho',
  'industrial', 'urban', 'loft',
  'luxury', 'glam', 'elegant', 'sophisticated', 'upscale',
  'playful', 'fun', 'whimsical', 'eclectic',
  'scandinavian', 'nordic', 'japanese', 'zen',
  'abstract', 'geometric', 'graphic',
  'nature', 'botanical', 'organic',
  'photography', 'photographic', 'photo',
  'illustration', 'illustrative', 'hand-drawn',
  'typography', 'typographic', 'lettering',
  'music', 'jazz', 'blues',
  'sports', 'athletic',
  'food', 'culinary',
  'travel', 'wanderlust', 'map', 'city',
  'animal', 'wildlife', 'floral', 'landscape',
];

const PALETTE_KEYWORDS = [
  'neutral', 'neutrals', 'beige', 'cream', 'ivory', 'tan', 'taupe', 'sand',
  'white', 'off-white', 'warm white',
  'black', 'charcoal', 'dark',
  'blue', 'blues', 'navy', 'cobalt', 'sky blue', 'teal', 'aqua', 'turquoise', 'indigo',
  'green', 'greens', 'sage', 'olive', 'forest', 'emerald', 'mint',
  'orange', 'amber', 'terracotta', 'rust', 'coral', 'sienna',
  'pink', 'blush', 'rose', 'dusty rose', 'mauve', 'fuchsia', 'magenta',
  'purple', 'lavender', 'violet', 'plum', 'lilac',
  'yellow', 'gold', 'golden', 'mustard', 'lemon',
  'red', 'crimson', 'burgundy', 'maroon', 'wine',
  'metallic', 'silver', 'copper', 'bronze', 'brass', 'chrome',
  'earth tones', 'earthy', 'warm', 'cool', 'muted', 'bold', 'vibrant',
  'monochrome', 'monochromatic', 'black and white', 'b&w',
];

const FIELD_ALIASES = {
  // Maps raw Jotform field labels → normalized keys
  'project name': 'projectName',
  'client name': 'projectName',
  'name': 'projectName',
  'project': 'projectName',
  'project type': 'projectType',
  'type of project': 'projectType',
  'venue type': 'projectType',
  'property type': 'projectType',
  'style': 'style',
  'design style': 'style',
  'aesthetic': 'style',
  'vibe': 'style',
  'look and feel': 'style',
  'color palette': 'palette',
  'palette': 'palette',
  'colors': 'palette',
  'color scheme': 'palette',
  'colour palette': 'palette',
  'avoid': 'avoid',
  'avoid themes': 'avoid',
  'please avoid': 'avoid',
  'do not include': 'avoid',
  "don't include": 'avoid',
  'room': 'rooms',
  'rooms': 'rooms',
  'spaces': 'rooms',
  'areas': 'rooms',
  'room needs': 'rooms',
  'gallery wall': 'galleryWall',
  'gallery walls': 'galleryWall',
  'need gallery wall': 'galleryWall',
  'piece count': 'pieceCount',
  'number of pieces': 'pieceCount',
  'quantity': 'pieceCount',
  'how many': 'pieceCount',
  'budget': 'budget',
  'notes': 'notes',
  'additional notes': 'notes',
  'special requests': 'notes',
  'comments': 'notes',
  'other': 'notes',
  'moodboard': 'moodboardUrl',
  'moodboard url': 'moodboardUrl',
  'inspiration': 'moodboardUrl',
  'pinterest': 'moodboardUrl',
};

/**
 * Extract key: value pairs from pasted Jotform text.
 * Handles multi-line values.
 */
function extractKeyValuePairs(text) {
  const pairs = {};
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  let currentKey = null;
  let currentValues = [];

  for (const line of lines) {
    // Check if line looks like "Label: Value" or "Label:"
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0 && colonIdx < 60) {
      const possibleKey = line.slice(0, colonIdx).trim().toLowerCase();
      const possibleValue = line.slice(colonIdx + 1).trim();

      // If it matches a known field, treat as new key
      if (FIELD_ALIASES[possibleKey] !== undefined || possibleKey.length < 40) {
        if (currentKey) {
          pairs[currentKey] = currentValues.join(' ').trim();
        }
        currentKey = possibleKey;
        currentValues = possibleValue ? [possibleValue] : [];
        continue;
      }
    }

    // Otherwise, continuation of previous value
    if (currentKey) {
      currentValues.push(line);
    }
  }

  if (currentKey) {
    pairs[currentKey] = currentValues.join(' ').trim();
  }

  return pairs;
}

/**
 * Extract keyword tags from a comma/semicolon-separated string.
 */
function extractTags(value, keywords) {
  if (!value) return [];
  const lower = value.toLowerCase();
  return keywords.filter(kw => lower.includes(kw.toLowerCase()));
}

/**
 * Detect project type from a string.
 */
function detectProjectType(value) {
  if (!value) return 'other';
  const lower = value.toLowerCase();
  for (const [kw, type] of Object.entries(PROJECT_TYPE_MAP)) {
    if (lower.includes(kw)) return type;
  }
  return 'other';
}

/**
 * Parse piece count from string.
 */
function parsePieceCount(value) {
  if (!value) return null;
  const match = value.match(/\d+/);
  return match ? parseInt(match[0], 10) : null;
}

/**
 * Main parser: takes raw pasted text, returns normalized brief.
 */
function parseBrief(rawText) {
  const pairs = extractKeyValuePairs(rawText);
  const normalized = {};

  // Map raw keys to normalized keys
  for (const [rawKey, value] of Object.entries(pairs)) {
    const normKey = FIELD_ALIASES[rawKey];
    if (normKey && !normalized[normKey]) {
      normalized[normKey] = value;
    }
  }

  // Also do a full-text fallback for fields not found via key matching
  const fullText = rawText.toLowerCase();

  const brief = {
    projectName: normalized.projectName || 'Untitled Project',
    projectType: normalized.projectType
      ? detectProjectType(normalized.projectType)
      : detectProjectType(fullText),
    styleTags: extractTags(
      (normalized.style || '') + ' ' + (normalized.notes || ''),
      STYLE_KEYWORDS
    ),
    paletteTags: extractTags(
      (normalized.palette || '') + ' ' + (normalized.notes || ''),
      PALETTE_KEYWORDS
    ),
    avoidTags: normalized.avoid
      ? normalized.avoid
          .toLowerCase()
          .split(/[,;\/]/)
          .map(s => s.trim())
          .filter(Boolean)
      : [],
    rooms: normalized.rooms
      ? normalized.rooms
          .split(/[,;\/]/)
          .map(s => s.trim())
          .filter(Boolean)
      : [],
    galleryWall: normalized.galleryWall
      ? /yes|y|true|1|definitely|absolutely/i.test(normalized.galleryWall)
      : fullText.includes('gallery wall'),
    pieceCount: parsePieceCount(normalized.pieceCount),
    moodboardUrl: normalized.moodboardUrl || null,
    budget: normalized.budget || null,
    notes: normalized.notes || null,
    rawText,
  };

  return brief;
}

module.exports = { parseBrief };
