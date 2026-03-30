/**
 * tagger.js
 * Derives structured tags from raw catalog record fields.
 * Input: { title, image_alt, source_collection, product_handle }
 * Output: { mood, subject, style, palette, sourceType }
 */

const MOOD_MAP = {
  dark: ['dark', 'night', 'noir', 'shadow', 'moody', 'gothic', 'dramatic', 'black', 'midnight', 'stormy'],
  bright: ['bright', 'vibrant', 'colorful', 'colourful', 'vivid', 'sunny', 'light', 'cheerful', 'happy', 'radiant'],
  playful: ['fun', 'whimsical', 'playful', 'quirky', 'cartoon', 'cute', 'silly', 'humorous', 'funny', 'comic'],
  calm: ['calm', 'serene', 'peaceful', 'tranquil', 'gentle', 'soft', 'minimal', 'still', 'quiet', 'meditative'],
  dramatic: ['dramatic', 'bold', 'powerful', 'striking', 'intense', 'epic', 'grand', 'majestic', 'awe'],
};

const SUBJECT_MAP = {
  music: ['music', 'guitar', 'piano', 'jazz', 'notes', 'band', 'vinyl', 'album', 'concert', 'melody', 'song', 'bass', 'drum', 'saxophone', 'trumpet', 'blues'],
  abstract: ['abstract', 'geometric', 'shapes', 'pattern', 'minimal', 'color field', 'colour field', 'texture', 'form', 'composition', 'lines', 'circles', 'squares'],
  landscape: ['landscape', 'mountain', 'mountains', 'forest', 'ocean', 'beach', 'nature', 'wilderness', 'canyon', 'valley', 'river', 'lake', 'waterfall', 'sunset', 'sunrise', 'sky', 'clouds', 'field', 'meadow', 'desert', 'tundra'],
  floral: ['floral', 'flower', 'flowers', 'botanical', 'garden', 'bloom', 'rose', 'plant', 'plants', 'leaf', 'leaves', 'foliage', 'daisy', 'tulip', 'orchid', 'peony', 'blossom', 'herb', 'fern'],
  typography: ['typography', 'quote', 'quotes', 'letter', 'letters', 'words', 'script', 'type', 'font', 'text', 'lettering', 'calligraphy', 'phrase'],
  city: ['city', 'urban', 'skyline', 'architecture', 'building', 'buildings', 'downtown', 'street', 'cityscape', 'map', 'paris', 'new york', 'nyc', 'london', 'chicago', 'tokyo', 'brooklyn'],
  animal: ['animal', 'animals', 'bird', 'birds', 'cat', 'cats', 'dog', 'dogs', 'fox', 'bear', 'wildlife', 'pet', 'horse', 'deer', 'lion', 'tiger', 'whale', 'fish', 'butterfly', 'bee', 'wolf', 'elephant', 'owl'],
  food: ['food', 'coffee', 'wine', 'cocktail', 'kitchen', 'culinary', 'chef', 'pizza', 'bread', 'fruit', 'vegetables', 'beer', 'tea'],
  people: ['portrait', 'figure', 'person', 'woman', 'man', 'people', 'face', 'silhouette'],
  celestial: ['space', 'stars', 'galaxy', 'moon', 'sun', 'celestial', 'cosmic', 'universe', 'planet', 'nebula', 'constellation'],
  coastal: ['beach', 'ocean', 'sea', 'wave', 'waves', 'surf', 'nautical', 'anchor', 'lighthouse', 'shell', 'coral', 'coastal', 'sand', 'tide'],
};

const STYLE_MAP = {
  modern: ['modern', 'contemporary', 'minimal', 'minimalist', 'clean lines', 'sleek'],
  vintage: ['vintage', 'retro', 'antique', 'old', 'classic', 'nostalgic', 'mid-century', 'midcentury'],
  coastal: ['coastal', 'beach', 'nautical', 'ocean', 'tropical', 'surf', 'island'],
  southern: ['southern', 'rustic', 'farmhouse', 'country', 'folk', 'americana', 'cabin', 'barn'],
  bohemian: ['bohemian', 'boho', 'eclectic', 'global', 'ethnic', 'tribal', 'mosaic'],
  photography: ['photograph', 'photo', 'photography', 'image', 'snapshot', 'camera'],
  illustration: ['illustration', 'illustrated', 'drawing', 'sketch', 'hand-drawn', 'painted', 'watercolor', 'gouache'],
  geometric: ['geometric', 'geometry', 'pattern', 'grid', 'hexagon', 'triangle', 'polygon'],
  industrial: ['industrial', 'urban', 'concrete', 'metal', 'loft', 'factory'],
  luxury: ['luxury', 'elegant', 'glamorous', 'opulent', 'sophisticated', 'upscale'],
  scandinavian: ['scandinavian', 'nordic', 'hygge', 'scandi'],
  japanese: ['japanese', 'japan', 'zen', 'sumi', 'wabi', 'ikebana', 'ukiyo'],
};

const PALETTE_MAP = {
  neutral: ['neutral', 'beige', 'cream', 'ivory', 'tan', 'taupe', 'sand', 'off-white', 'warm white'],
  white: ['white'],
  black: ['black', 'charcoal', 'dark', 'ebony', 'onyx'],
  blue: ['blue', 'navy', 'cobalt', 'azure', 'sky', 'teal', 'aqua', 'turquoise', 'indigo', 'cerulean', 'sapphire'],
  green: ['green', 'sage', 'olive', 'forest', 'emerald', 'mint', 'lime', 'jade', 'moss'],
  orange: ['orange', 'amber', 'terracotta', 'rust', 'coral', 'sienna', 'peach', 'clay'],
  pink: ['pink', 'blush', 'rose', 'mauve', 'fuchsia', 'magenta', 'dusty rose', 'salmon'],
  purple: ['purple', 'lavender', 'violet', 'plum', 'lilac', 'eggplant', 'amethyst'],
  yellow: ['yellow', 'gold', 'golden', 'mustard', 'lemon', 'sunflower', 'butter'],
  red: ['red', 'crimson', 'burgundy', 'maroon', 'wine', 'scarlet', 'cherry'],
  metallic: ['metallic', 'silver', 'copper', 'bronze', 'brass', 'chrome', 'gold'],
};

const SOURCE_TYPE_MAP = {
  art_print: ['art-prints', 'art-print'],
  canvas_print: ['canvas-prints', 'canvas-print'],
  wood_wall_art: ['wood-wall-art', 'wood'],
};

/**
 * Score a string against a keyword map and return matching keys.
 */
function matchKeywords(str, keywordMap) {
  const lower = str.toLowerCase();
  const matches = [];
  for (const [tag, keywords] of Object.entries(keywordMap)) {
    if (keywords.some(kw => lower.includes(kw))) {
      matches.push(tag);
    }
  }
  return matches;
}

/**
 * Derive source type from collection name.
 */
function getSourceType(sourceCollection) {
  const lower = (sourceCollection || '').toLowerCase();
  for (const [type, patterns] of Object.entries(SOURCE_TYPE_MAP)) {
    if (patterns.some(p => lower.includes(p))) return type;
  }
  return 'art_print';
}

/**
 * Tag a single catalog record.
 * @param {Object} record - raw catalog record
 * @returns {Object} - record with .tags added
 */
function tagRecord(record) {
  const searchText = [
    record.title || '',
    record.image_alt || '',
    record.product_handle || '',
    record.source_collection || '',
  ]
    .join(' ')
    .toLowerCase();

  const tags = {
    mood: matchKeywords(searchText, MOOD_MAP),
    subject: matchKeywords(searchText, SUBJECT_MAP),
    style: matchKeywords(searchText, STYLE_MAP),
    palette: matchKeywords(searchText, PALETTE_MAP),
    sourceType: getSourceType(record.source_collection),
  };

  return {
    ...record,
    searchText,
    tags,
  };
}

/**
 * Tag an entire catalog.
 * @param {Array} records - raw catalog records
 * @returns {Array} - tagged records
 */
function tagCatalog(records) {
  return records.map(tagRecord);
}

module.exports = { tagCatalog, tagRecord };
