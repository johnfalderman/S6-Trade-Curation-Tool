import PptxGenJS from 'pptxgenjs';

// ── Palette ──────────────────────────────────────────────────────────────────
const C = {
  cream:   'FAF8F0',   // warm off-white background
  dark:    '1C1C1E',   // near-black text
  mid:     '6B7280',   // medium gray
  muted:   'A0A7B0',   // light gray
  white:   'FFFFFF',
  gridBg:  'EFEFED',   // light warm gray for grid slide bg (like Lyfe Kitchen)
  darkBar: '1C1C1E',   // footer bar on cover
};

// ── Image fetching ────────────────────────────────────────────────────────────
async function fetchImg(url) {
  if (!url) return null;
  try {
    const full = url.startsWith('/') ? 'https://society6.com' + url : url;
    const res = await fetch(full, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; S6TradeBot/1.0)' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const mime = (res.headers.get('content-type') || 'image/jpeg').split(';')[0];
    return 'data:' + mime + ';base64,' + Buffer.from(buf).toString('base64');
  } catch {
    return null;
  }
}

// Fetch all images in parallel (faster than batching for Netlify timeout)
async function prefetchImages(items) {
  return Promise.all(items.map(it => fetchImg(it.image_url)));
}

function fullUrl(url) {
  if (!url) return 'https://society6.com';
  return url.startsWith('/') ? 'https://society6.com' + url : url;
}

function safeName(str) {
  return (str || 'S6-Curation').replace(/[^a-zA-Z0-9\s-]/g, '').trim();
}

// ── Cover slide ───────────────────────────────────────────────────────────────
// Layout (top → bottom):
//   – Client name (large, prominent) + location underneath
//   – Project name (medium, styled) below client block
//   – Dark footer bar: søciety6 Trade  |  provider name / contact
function addCoverSlide(pres, brief, providerInfo = {}) {
  const sl = pres.addSlide();
  sl.background = { color: C.cream };

  const clientName  = brief.clientName  || brief.projectName || 'Trade Curation';
  const location    = brief.location    || '';
  const projectName = brief.projectName || '';

  // ── Client name — largest, top-center ──────────────────────────────────────
  sl.addText(clientName, {
    x: 0.7, y: 0.85, w: 8.6, h: 1.5,
    fontSize: 52, fontFace: 'Georgia', color: C.dark,
    bold: false, align: 'center', valign: 'middle',
  });

  // ── Location — below client name ────────────────────────────────────────────
  if (location) {
    sl.addText(location, {
      x: 0.7, y: 2.45, w: 8.6, h: 0.42,
      fontSize: 18, fontFace: 'Arial', color: C.mid,
      align: 'center',
    });
  }

  // ── Project name / type — smaller, below location ───────────────────────────
  const projectLabel = projectName && projectName !== clientName
    ? projectName
    : (brief.projectType
        ? brief.projectType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) + ' Curation'
        : '');
  if (projectLabel) {
    sl.addText(projectLabel, {
      x: 0.7, y: location ? 3.0 : 2.7, w: 8.6, h: 0.42,
      fontSize: 15, fontFace: 'Arial', color: C.muted,
      align: 'center',
    });
  }

  // ── Dark footer bar ─────────────────────────────────────────────────────────
  sl.addShape('rect', {
    x: 0, y: 4.625, w: 10, h: 1.0,
    fill: { color: C.darkBar }, line: { color: C.darkBar },
  });

  // søciety6 Trade — left side of footer
  sl.addText('søciety6  Trade', {
    x: 0.5, y: 4.625, w: 4.0, h: 1.0,
    fontSize: 17, fontFace: 'Arial', bold: true, color: C.white,
    valign: 'middle',
  });

  // Provider name + contact — right side of footer
  const providerName    = providerInfo.name    || '';
  const providerContact = providerInfo.email   || providerInfo.phone || '';
  const providerLine    = [providerName, providerContact].filter(Boolean).join('  ·  ');
  if (providerLine) {
    sl.addText(providerLine, {
      x: 4.6, y: 4.625, w: 5.1, h: 1.0,
      fontSize: 13, fontFace: 'Arial', color: 'CCCCCC',
      align: 'right', valign: 'middle',
    });
  }
}

// ── Section intro slide ───────────────────────────────────────────────────────
// Style: cream bg, large left-aligned serif title, søciety6 bottom-right
function addSectionSlide(pres, title, subtitle) {
  const sl = pres.addSlide();
  sl.background = { color: C.cream };

  sl.addText(title, {
    x: 0.75, y: 1.7, w: 8.5, h: 1.1,
    fontSize: 40, fontFace: 'Georgia', color: C.dark,
    bold: false, align: 'left',
  });

  if (subtitle) {
    sl.addText(subtitle, {
      x: 0.75, y: 2.9, w: 8.5, h: 0.5,
      fontSize: 16, fontFace: 'Arial', color: C.mid,
      align: 'left',
    });
  }

  // søciety6 wordmark bottom-right
  sl.addText('søciety6', {
    x: 7.3, y: 5.05, w: 2.4, h: 0.4,
    fontSize: 16, fontFace: 'Arial', bold: true, color: C.dark,
    align: 'right',
  });
}

// ── Grid slide ────────────────────────────────────────────────────────────────
// 6 columns × 2 rows = up to 12 items per slide
// Each item: white frame + mat effect + embedded image + clickable link
function addGridSlide(pres, items, imgDataArr, categoryLabel) {
  const sl = pres.addSlide();
  sl.background = { color: C.gridBg };

  // Category label — small, top left
  if (categoryLabel) {
    sl.addText(categoryLabel, {
      x: 0.28, y: 0.1, w: 9.4, h: 0.32,
      fontSize: 10, fontFace: 'Arial', color: C.mid,
    });
  }

  // Layout constants
  const COLS      = 6;
  const ROWS      = 2;
  const marginL   = 0.28;
  const marginR   = 0.28;
  const marginT   = 0.52;   // top of first frame row
  const marginB   = 0.12;
  const gapX      = 0.1;    // horizontal gap between frames
  const gapY      = 0.14;   // vertical gap between rows

  const totalW    = 10 - marginL - marginR;
  const totalH    = 5.625 - marginT - marginB;
  const frameW    = (totalW - (COLS - 1) * gapX) / COLS;   // ≈1.49"
  const frameH    = (totalH - (ROWS - 1) * gapY) / ROWS;   // ≈2.43"

  // Mat insets (white border inside the frame background)
  const matH      = frameH * 0.072;   // top mat
  const matSide   = frameW * 0.072;   // left/right mat
  const matBot    = frameH * 0.055;   // bottom mat (slightly smaller)

  items.forEach((item, idx) => {
    if (idx >= COLS * ROWS) return;

    const col = idx % COLS;
    const row = Math.floor(idx / COLS);
    const fx  = marginL + col * (frameW + gapX);
    const fy  = marginT + row * (frameH + gapY);

    const imgData    = imgDataArr[idx] || null;
    const productUrl = fullUrl(item.product_url);

    // White frame background with soft shadow
    sl.addShape('rect', {
      x: fx, y: fy, w: frameW, h: frameH,
      fill: { color: C.white },
      line: { color: 'E0DDD8', width: 0.5 },
      shadow: {
        type: 'outer',
        blur: 4, offset: 1.5, angle: 135,
        color: '888888', opacity: 0.18,
      },
    });

    // Image area (inset from frame to create white mat look)
    const imgX = fx + matSide;
    const imgY = fy + matH;
    const imgW = frameW - matSide * 2;
    const imgH = frameH - matH - matBot;

    if (imgData) {
      sl.addImage({
        data: imgData,
        x: imgX, y: imgY, w: imgW, h: imgH,
        sizing: { type: 'contain', w: imgW, h: imgH },
      });
      // pptxgenjs silently drops hyperlink when sizing is set on addImage,
      // so we overlay a transparent text element to carry the clickable link.
      sl.addText('', {
        x: imgX, y: imgY, w: imgW, h: imgH,
        hyperlink: { url: productUrl, tooltip: 'View on Society6' },
        fontSize: 1, color: 'FFFFFF',
      });
    } else {
      // Fallback: light gray placeholder + title text
      sl.addShape('rect', {
        x: imgX, y: imgY, w: imgW, h: imgH,
        fill: { color: 'F0EEEA' }, line: { color: 'E0DDD8', width: 0.3 },
      });
      sl.addText(item.title || '', {
        x: imgX + 0.04, y: imgY + imgH * 0.3, w: imgW - 0.08, h: imgH * 0.4,
        fontSize: 6.5, fontFace: 'Arial', color: C.mid,
        align: 'center', wrap: true,
      });
      // Still make it clickable: overlay a transparent text element (shapes don't support hyperlinks in pptxgenjs)
      sl.addText('', {
        x: imgX, y: imgY, w: imgW, h: imgH,
        hyperlink: { url: productUrl },
        fontSize: 1, color: 'FFFFFF',
      });
    }
  });
}

// ── createSlidesDeck ─────────────────────────────────────────────────────────
export async function createSlidesDeck({ brief = {}, primary = [], accent = [], galleryWallSets = [], providerInfo = {} } = {}) {
  try {

    // Fetch images in parallel — all at once to minimize wall-clock time
    // Cap deck at 24 primary + 12 accent to stay within Netlify timeout
    const deckPrimary = primary.slice(0, 24);
    const deckAccent  = accent.slice(0, 12);

    const [primaryImgs, accentImgs] = await Promise.all([
      prefetchImages(deckPrimary),
      prefetchImages(deckAccent),
    ]);

    const pres = new PptxGenJS();
    pres.layout = 'LAYOUT_16x9';

    // 1 — Cover
    addCoverSlide(pres, brief, providerInfo);

    // 2 — Primary collection
    if (deckPrimary.length > 0) {
      addSectionSlide(pres, 'Curated Art Collection', 'Inspired selections personalized for you');
      const GRID = 12;
      for (let i = 0; i < deckPrimary.length; i += GRID) {
        addGridSlide(
          pres,
          deckPrimary.slice(i, i + GRID),
          primaryImgs.slice(i, i + GRID),
          'Art Prints — Primary Collection',
        );
      }
    }

    // 3 — Accent & alternates
    if (deckAccent.length > 0) {
      addSectionSlide(pres, 'Accent & Alternates', 'Supporting pieces and complementary works');
      const GRID = 12;
      for (let i = 0; i < deckAccent.length; i += GRID) {
        addGridSlide(
          pres,
          deckAccent.slice(i, i + GRID),
          accentImgs.slice(i, i + GRID),
          'Accent Collection',
        );
      }
    }

    // 4 — Gallery wall sets
    if (galleryWallSets?.length > 0) {
      addSectionSlide(pres, 'Gallery Wall Sets', 'Curated groupings for gallery walls');
      for (const gwSet of galleryWallSets) {
        const gwItems = (gwSet.items || []).slice(0, 12);
        const gwImgs  = await prefetchImages(gwItems);
        const label   = `Gallery Wall Set ${gwSet.setNumber || ''}${gwSet.theme ? ' — ' + gwSet.theme : ''}`.trim();
        addGridSlide(pres, gwItems, gwImgs, label);
      }
    }

    const buffer   = await pres.write({ outputType: 'nodebuffer' });
    const filename = safeName(brief.projectName) + '-Society6.pptx';

    return {
      success: true,
      pptxBase64: Buffer.from(buffer).toString('base64'),
      filename,
    };

  } catch (error) {
    console.error('PPTX generation error:', error);
    return { error: error.message };
  }
}
