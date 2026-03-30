/**
 * recommender.js
 * Scores a tagged catalog against a parsed brief.
 * Returns primary collection, accent/alternates, and gallery wall sets.
 */

// Scoring weights
const WEIGHTS = {
  styleMatch: 3,
  paletteMatch: 2,
  subjectMatch: 2,
  moodMatch: 1.5,
  collectionFit: 1,
  avoidPenalty: -15,
  keywordBonus: 1,
};

// How many items to return per section
const LIMITS = {
  primary: 12,
  accent: 8,
  galleryWall: 18, // 3 sets of 6
};

const GALLERY_WALL_SET_SIZE = 6;

/**
 * Build a keyword list from the brief for fuzzy title matching.
 */
function buildBriefKeywords(brief) {
  const words = [
    ...brief.styleTags,
    ...brief.paletteTags,
    ...(brief.rooms || []),
    brief.projectType,
  ]
    .join(' ')
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 3);
  return [...new Set(words)];
}

/**
 * Score a single tagged catalog item against a brief.
 */
function scoreItem(item, brief) {
  let score = 0;
  const reasons = [];

  // Style matches
  const styleMatches = item.tags.style.filter(t => brief.styleTags.includes(t));
  if (styleMatches.length > 0) {
    score += styleMatches.length * WEIGHTS.styleMatch;
    reasons.push(`style: ${styleMatches.join(', ')}`);
  }

  // Palette matches
  const paletteMatches = item.tags.palette.filter(t => brief.paletteTags.includes(t));
  if (paletteMatches.length > 0) {
    score += paletteMatches.length * WEIGHTS.paletteMatch;
    reasons.push(`palette: ${paletteMatches.join(', ')}`);
  }

  // Subject matches (style tags sometimes describe subjects)
  const subjectMatches = item.tags.subject.filter(t => brief.styleTags.includes(t));
  if (subjectMatches.length > 0) {
    score += subjectMatches.length * WEIGHTS.subjectMatch;
    reasons.push(`subject: ${subjectMatches.join(', ')}`);
  }

  // Mood matches
  const moodMatches = item.tags.mood.filter(t => brief.styleTags.includes(t));
  if (moodMatches.length > 0) {
    score += moodMatches.length * WEIGHTS.moodMatch;
    reasons.push(`mood: ${moodMatches.join(', ')}`);
  }

  // Project type → source type fit
  if (brief.projectType === 'hotel' && item.tags.sourceType === 'canvas_print') {
    score += WEIGHTS.collectionFit;
  }
  if (brief.projectType === 'restaurant' && item.tags.sourceType === 'art_print') {
    score += WEIGHTS.collectionFit;
  }
  if (brief.projectType === 'vacation_rental' && item.tags.sourceType === 'wood_wall_art') {
    score += WEIGHTS.collectionFit;
  }

  // Title/alt keyword fuzzy bonus
  const briefKeywords = buildBriefKeywords(brief);
  const keywordHits = briefKeywords.filter(kw => item.searchText.includes(kw));
  if (keywordHits.length > 0) {
    score += keywordHits.length * WEIGHTS.keywordBonus;
    reasons.push(`keyword: ${keywordHits.slice(0, 3).join(', ')}`);
  }

  // Avoid penalty
  for (const avoidTerm of brief.avoidTags) {
    if (avoidTerm && item.searchText.includes(avoidTerm.toLowerCase())) {
      score += WEIGHTS.avoidPenalty;
      reasons.push(`⚠ avoid: ${avoidTerm}`);
    }
  }

  return { score, reasons };
}

/**
 * Deduplicate by artwork_family if present, else by similar title prefix.
 */
function deduplicateBySimilarity(items) {
  const seen = new Set();
  return items.filter(item => {
    // Use artwork_family if available
    const familyKey = item.artwork_family || item.product_handle;
    // Fallback: first 5 words of title
    const titleKey = (item.title || '')
      .toLowerCase()
      .split(/\s+/)
      .slice(0, 4)
      .join('-');
    const key = familyKey || titleKey;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Build gallery wall sets from a pool of candidates.
 * Groups by similar style + palette tags for visual cohesion.
 */
function buildGalleryWallSets(candidates, numSets = 3) {
  if (candidates.length < GALLERY_WALL_SET_SIZE) return [];

  const sets = [];
  const used = new Set();

  // Strategy: each set starts with the highest-scored unused item,
  // then fills with items sharing at least one tag.
  let remaining = candidates.filter(c => c.score > 0);

  for (let s = 0; s < numSets; s++) {
    const anchor = remaining.find(c => !used.has(c.product_url));
    if (!anchor) break;

    used.add(anchor.product_url);
    const set = [anchor];

    const anchorTags = [
      ...anchor.tags.style,
      ...anchor.tags.palette,
      ...anchor.tags.subject,
    ];

    for (const candidate of remaining) {
      if (set.length >= GALLERY_WALL_SET_SIZE) break;
      if (used.has(candidate.product_url)) continue;
      if (candidate.product_url === anchor.product_url) continue;

      const candidateTags = [
        ...candidate.tags.style,
        ...candidate.tags.palette,
        ...candidate.tags.subject,
      ];
      const overlap = anchorTags.filter(t => candidateTags.includes(t));

      if (overlap.length >= 1) {
        set.push(candidate);
        used.add(candidate.product_url);
      }
    }

    // If we couldn't fill the set via tags, pad with any unused
    for (const candidate of remaining) {
      if (set.length >= GALLERY_WALL_SET_SIZE) break;
      if (!used.has(candidate.product_url)) {
        set.push(candidate);
        used.add(candidate.product_url);
      }
    }

    if (set.length >= 3) {
      sets.push({
        setNumber: s + 1,
        theme: describeSetTheme(set),
        items: set,
      });
    }

    remaining = remaining.filter(c => !used.has(c.product_url));
  }

  return sets;
}

/**
 * Generate a human-readable theme description for a gallery wall set.
 */
function describeSetTheme(items) {
  const allTags = items.flatMap(i => [
    ...i.tags.style,
    ...i.tags.palette,
    ...i.tags.subject,
  ]);
  const freq = {};
  for (const t of allTags) {
    freq[t] = (freq[t] || 0) + 1;
  }
  const topTags = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([t]) => t);
  return topTags.length > 0 ? topTags.join(' + ') : 'mixed';
}

/**
 * Format a product URL — ensure it's a full URL.
 */
function ensureFullUrl(url) {
  if (!url) return '';
  if (url.startsWith('http')) return url;
  if (url.startsWith('/')) return `https://society6.com${url}`;
  return `https://society6.com/${url}`;
}

/**
 * Main recommend function.
 * @param {Array} taggedCatalog - catalog records with .tags
 * @param {Object} brief - parsed brief
 * @returns {Object} - { primary, accent, galleryWallSets, brief }
 */
function recommend(taggedCatalog, brief) {
  // Score every item
  const scored = taggedCatalog
    .map(item => {
      const { score, reasons } = scoreItem(item, brief);
      return {
        ...item,
        score,
        reasons,
        product_url: ensureFullUrl(item.product_url),
      };
    })
    .filter(item => item.score > -5) // drop hard-avoided items
    .sort((a, b) => b.score - a.score);

  // Deduplicate
  const deduped = deduplicateBySimilarity(scored);

  // Primary: top scorers
  const primary = deduped.slice(0, LIMITS.primary);

  // Accent: next tier (different vibe from primary)
  const accentPool = deduped.slice(LIMITS.primary, LIMITS.primary + LIMITS.accent * 3);
  const accent = accentPool
    .filter(item => {
      // Filter for some variety vs primary
      const primaryTags = primary.flatMap(p => p.tags.style);
      const itemTags = item.tags.style;
      const novelTags = itemTags.filter(t => !primaryTags.includes(t));
      return novelTags.length > 0 || accentPool.indexOf(item) < 4;
    })
    .slice(0, LIMITS.accent);

  // Gallery wall sets: from the broader scored pool
  const gwPool = deduped.filter(
    item =>
      !primary.find(p => p.product_url === item.product_url) &&
      !accent.find(a => a.product_url === item.product_url)
  );

  const galleryWallSets = brief.galleryWall ? buildGalleryWallSets(gwPool, 3) : [];

  return {
    brief,
    primary,
    accent,
    galleryWallSets,
    totalScored: scored.length,
  };
}

module.exports = { recommend };
