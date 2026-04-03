/**
 * Generates a .pptx deck using pptxgenjs.
 * Grid layout: imagesPerSlide artworks per slide (default 8 = 4 cols x 2 rows).
 * All images fetched concurrently. Images + captions are clickable hyperlinks.
 * Cover slide shows: projectName, clientName, location.
 */

const DARK_BG    = '14141E';
const SECTION_BG = '1E1E32';
const LIGHT_BG   = 'FAFAFA';
const BRIEF_BG   = 'F5F5F8';
const WHITE      = 'FFFFFF';
const LIGHT_GRAY = 'AAAACC';
const DARK_TEXT  = '141428';
const S6_RED     = 'E8382C';

/**
 * Convert a relative Society6 path to an absolute URL.
 * pptxgenjs 3.12.0 crashes (TDZ error) on relative or empty hyperlink URLs.
 * Returns null if url is falsy so callers can skip the hyperlink prop entirely.
 */
function absUrl(url) {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return 'https://society6.com' + (url.startsWith('/') ? '' : '/') + url;
}

/**
 * Fetch an image and return { data: 'data:<mime>;base64,...', aspect } or null.
 * Using base64 data is more reliable than path in serverless environments.
 */
async function fetchImg(url) {
  const full = absUrl(url);
  if (!full) return null;
  try {
    const res = await fetch(full, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) return null;
    const mime = (res.headers.get('content-type') || 'image/jpeg').split(';')[0];
    const b64 = buf.toString('base64');
    let aspect = 1;
    if (mime === 'image/jpeg' || mime === 'image/jpg') {
      for (let i = 0; i < buf.length - 8; i++) {
        if (buf[i] === 0xFF && (buf[i+1] >= 0xC0 && buf[i+1] <= 0xC3)) {
          const h = buf.readUInt16BE(i + 5);
          const w = buf.readUInt16BE(i + 7);
          if (h > 0 && w > 0) { aspect = w / h; break; }
        }
      }
    } else if (mime === 'image/png') {
      if (buf.length > 24 && buf.readUInt32BE(12) === 0x49484452) {
        const w = buf.readUInt32BE(16);
        const h = buf.readUInt32BE(20);
        if (h > 0 && w > 0) aspect = w / h;
      }
    }
    return { data: 'data:' + mime + ';base64,' + b64, aspect };
  } catch {
    return null;
  }
}

export async function createSlidesDeck(brief, { primary = [], accent = [], galleryWallSets = [], imagesPerSlide = 8 }) {
  const PptxGenJS = (await import('pptxgenjs')).default;
  const pptx = new PptxGenJS();

  pptx.layout = 'LAYOUT_WIDE'; // 13.33" x 7.5"
  pptx.title = `${brief.projectName || 'S6 Trade Curation'} \u2014 Society6 Recommendations`;
  pptx.author = 'Society6 Trade Team';

  const date = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  // -- Pre-fetch ALL images concurrently (much faster than sequential)
  const allItems = [
    ...primary,
    ...accent,
    ...(galleryWallSets.flatMap(s => s.items || [])),
  ];
  const imgCache = new Map();
  await Promise.allSettled(
    allItems.map(async (item) => {
      if (item.image_url && !imgCache.has(item.image_url)) {
        const info = await fetchImg(item.image_url);
        if (info) imgCache.set(item.image_url, info);
      }
    })
  );

  // -- Cover slide
  const cover = pptx.addSlide();
  cover.background = { color: DARK_BG };
  cover.addText(brief.projectName || 'Trade Curation', {
    x: 0.6, y: 1.8, w: 12, h: 1.2,
    fontSize: 44, bold: true, color: WHITE, fontFace: 'Arial',
  });
  let coverY = 3.15;
  if (brief.clientName) {
    cover.addText(brief.clientName, {
      x: 0.6, y: coverY, w: 10, h: 0.55,
      fontSize: 22, color: LIGHT_GRAY, fontFace: 'Arial',
    });
    coverY += 0.6;
  }
  if (brief.location) {
    cover.addText(brief.location, {
      x: 0.6, y: coverY, w: 10, h: 0.45,
      fontSize: 16, color: LIGHT_GRAY, fontFace: 'Arial',
    });
  }
  cover.addText('Society6 Wall Art Curation  \u2022  ' + date, {
    x: 0.6, y: 6.4, w: 10, h: 0.4,
    fontSize: 13, color: LIGHT_GRAY, fontFace: 'Arial',
  });
  cover.addText('society6.com/trade', {
    x: 0.6, y: 6.9, w: 4, h: 0.3,
    fontSize: 11, color: LIGHT_GRAY, fontFace: 'Arial',
    hyperlink: { url: 'https://society6.com/trade' },
  });

  // -- Brief summary slide
  const briefSlide = pptx.addSlide();
  briefSlide.background = { color: BRIEF_BG };
  briefSlide.addText('Project Brief', {
    x: 0.5, y: 0.3, w: 12, h: 0.7,
    fontSize: 26, bold: true, color: DARK_TEXT, fontFace: 'Arial',
  });

  const briefLines = [
    { text: 'Client: ' + (brief.clientName || '\u2014'), options: { bold: true } },
    { text: 'Project: ' + (brief.projectName || '\u2014'), options: {} },
    { text: 'Location: ' + (brief.location || '\u2014'), options: {} },
    { text: 'Type: ' + (brief.projectType || '\u2014'), options: {} },
    { text: 'Style: ' + ((brief.styleTags || []).join(', ') || '\u2014'), options: {} },
    { text: 'Palette: ' + ((brief.paletteTags || []).join(', ') || '\u2014'), options: {} },
    { text: 'Avoid: ' + ((brief.avoidTags || []).join(', ') || '\u2014'), options: { color: 'AA3333' } },
    { text: 'Rooms: ' + ((brief.rooms || []).join(', ') || '\u2014'), options: {} },
    { text: 'Gallery Wall: ' + (brief.galleryWall ? 'Yes' : 'No'), options: {} },
    { text: 'Target Pieces: ' + (brief.targetPieceCount || brief.pieceCount || '\u2014'), options: {} },
  ];

  const briefTextArr = briefLines.map(line => ({
    text: line.text + '\n',
    options: { fontSize: 13, color: line.options.color || DARK_TEXT, bold: line.options.bold || false, fontFace: 'Arial' }
  }));

  briefSlide.addText(briefTextArr, {
    x: 0.5, y: 1.2, w: 12, h: 5.5, valign: 'top',
  });

  // -- Section header helper
  function addSectionHeader(label, subtitle) {
    const s = pptx.addSlide();
    s.background = { color: SECTION_BG };
    s.addText(label, {
      x: 0.6, y: 2.6, w: 12, h: 1,
      fontSize: 36, bold: true, color: WHITE, fontFace: 'Arial',
    });
    if (subtitle) {
      s.addText(subtitle, {
        x: 0.6, y: 3.7, w: 12, h: 0.5,
        fontSize: 15, color: LIGHT_GRAY, fontFace: 'Arial',
      });
    }
  }

  // -- Grid slide helper: up to imagesPerSlide images in a 4-column grid
  // Images and captions are both hyperlinked to Society6 product pages.
  function addGridSlide(items, sectionLabel, slideNum) {
    const COLS = 4;
    const rows = Math.ceil(items.length / COLS);

    // Layout constants (inches, LAYOUT_WIDE = 13.33 x 7.5)
    const marginX  = 0.18;
    const marginTop = 0.42; // space for slide label
    const gapX     = 0.1;
    const gapY     = 0.08;
    const captionH = 0.38;

    const cellW = (13.33 - 2 * marginX - (COLS - 1) * gapX) / COLS; // ~3.17"
    const totalImgH = 7.5 - marginTop - rows * captionH - (rows - 1) * gapY;
    const imgH = totalImgH / rows;

    const s = pptx.addSlide();
    s.background = { color: LIGHT_BG };

    // Slide label
    s.addText(sectionLabel + '  |  Slide ' + slideNum, {
      x: 0.18, y: 0.08, w: 10, h: 0.28,
      fontSize: 9, color: 'AAAAAA', fontFace: 'Arial',
    });

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const cellX = marginX + col * (cellW + gapX);
      const cellY = marginTop + row * (imgH + captionH + gapY);

      const productLink = absUrl(item.product_url);
      const imgInfo = imgCache.get(item.image_url);

      if (imgInfo && imgInfo.data) {
        // Fit image preserving aspect ratio within cell bounds
        let drawW = cellW;
        let drawH = cellW / (imgInfo.aspect || 1);
        if (drawH > imgH) { drawH = imgH; drawW = imgH * (imgInfo.aspect || 1); }
        const drawX = cellX + (cellW - drawW) / 2;
        const drawY = cellY + (imgH - drawH) / 2;

        const imgOpts = { data: imgInfo.data, x: drawX, y: drawY, w: drawW, h: drawH };
        if (productLink) imgOpts.hyperlink = { url: productLink, tooltip: 'View on Society6' };
        s.addImage(imgOpts);
      } else {
        // Placeholder rect when image unavailable
        s.addShape('rect', {
          x: cellX, y: cellY, w: cellW, h: imgH,
          fill: { color: 'EEEEEE' }, line: { color: 'DDDDDD' },
        });
      }

      // Caption text below image -- also hyperlinked
      const captionOpts = {
        x: cellX, y: cellY + imgH + 0.02, w: cellW, h: captionH,
        fontSize: 7, color: DARK_TEXT, fontFace: 'Arial',
        align: 'center', valign: 'top', wrap: true,
      };
      if (productLink) captionOpts.hyperlink = { url: productLink };
      s.addText((item.title || 'Untitled').substring(0, 60), captionOpts);
    }
  }

  // -- Primary Collection
  if (primary.length > 0) {
    addSectionHeader('Primary Collection', primary.length + ' curated selections');
    for (let start = 0; start < primary.length; start += imagesPerSlide) {
      const chunk = primary.slice(start, start + imagesPerSlide);
      addGridSlide(chunk, 'Primary', Math.floor(start / imagesPerSlide) + 1);
    }
  }

  // -- Accent & Alternates
  if (accent.length > 0) {
    addSectionHeader('Accent & Alternates', accent.length + ' additional options');
    for (let start = 0; start < accent.length; start += imagesPerSlide) {
      const chunk = accent.slice(start, start + imagesPerSlide);
      addGridSlide(chunk, 'Accent', Math.floor(start / imagesPerSlide) + 1);
    }
  }

  // -- Gallery Wall Sets
  if (galleryWallSets.length > 0) {
    addSectionHeader('Gallery Wall Sets', 'Suggested groupings for gallery walls');
    for (const setObj of galleryWallSets) {
      const s = pptx.addSlide();
      s.background = { color: LIGHT_BG };
      s.addText('Gallery Wall Set ' + setObj.setNumber + (setObj.theme ? ': ' + setObj.theme : ''), {
        x: 0.4, y: 0.2, w: 12, h: 0.6,
        fontSize: 22, bold: true, color: DARK_TEXT, fontFace: 'Arial',
      });
      const items = setObj.items || [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const col = i % 3;
        const row = Math.floor(i / 3);
        const cx = 0.4 + col * 4.3;
        const cy = 1.0 + row * 3.2;
        const gwLink = absUrl(item.product_url);
        const gwImg = imgCache.get(item.image_url);
        if (gwImg && gwImg.data) {
          const imgOpts = { data: gwImg.data, x: cx, y: cy, w: 3.8, h: 2.5 };
          if (gwLink) imgOpts.hyperlink = { url: gwLink, tooltip: 'View on Society6' };
          s.addImage(imgOpts);
        } else {
          s.addShape('rect', {
            x: cx, y: cy, w: 3.8, h: 2.5,
            fill: { color: 'EEEEEE' }, line: { color: 'DDDDDD' },
          });
        }
        const titleOpts = {
          x: cx, y: cy + 2.55, w: 3.8, h: 0.45,
          fontSize: 8, color: DARK_TEXT, fontFace: 'Arial',
        };
        if (gwLink) titleOpts.hyperlink = { url: gwLink };
        s.addText(item.title || '', titleOpts);
      }
    }
  }

  // -- Generate base64 output
  const pptxBase64 = await pptx.write({ outputType: 'base64' });
  const slug = (brief.projectName || 'S6-Curation').replace(/[^a-z0-9]/gi, '-').replace(/-+/g, '-');
  const filename = slug + '-Society6.pptx';

  return { pptxBase64, filename };
}
