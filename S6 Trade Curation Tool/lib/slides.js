/**
 * Generates a .pptx deck using pptxgenjs.
 * No Google credentials needed. Returns base64 PPTX for direct download.
 * Images and "View on Society6" links are clickable in the final deck.
 */

const DARK_BG    = '14141E';
const SECTION_BG = '1E1E32';
const LIGHT_BG   = 'FAFAFA';
const BRIEF_BG   = 'F5F5F8';
const WHITE      = 'FFFFFF';
const LIGHT_GRAY = 'AAAACC';
const DARK_TEXT  = '141428';
const MID_TEXT   = '555566';
const S6_RED     = 'E8382C';
const LINK_BLUE  = '2D5FCC';

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
 * Using base64 data is more reliable than `path` in serverless environments.
 */
async function fetchImg(url) {
  const full = absUrl(url);
  if (!full) return null;
  try {
    const res = await fetch(full, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(8000),
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

export async function createSlidesDeck(brief, { primary = [], accent = [], galleryWallSets = [] }) {
  const PptxGenJS = (await import('pptxgenjs')).default;
  const pptx = new PptxGenJS();

  pptx.layout = 'LAYOUT_WIDE'; // 13.33" x 7.5"
  pptx.title = `${brief.projectName || 'S6 Trade Curation'} \u2014 Society6 Recommendations`;
  pptx.author = 'Society6 Trade Team';

  const date = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  // -- Cover slide -------------------------------------------------------------
  const cover = pptx.addSlide();
  cover.background = { color: DARK_BG };
  cover.addText(brief.projectName || 'Trade Curation', {
    x: 0.6, y: 2.4, w: 12, h: 1.1,
    fontSize: 44, bold: true, color: WHITE, fontFace: 'Arial',
  });
  if (brief.clientName) {
    cover.addText(brief.clientName, {
      x: 0.6, y: 3.55, w: 10, h: 0.55,
      fontSize: 20, color: LIGHT_GRAY, fontFace: 'Arial',
    });
  }
  cover.addText(`Society6 Wall Art Curation  \u2022  ${date}`, {
    x: 0.6, y: 3.65 + (brief.clientName ? 0.6 : 0), w: 10, h: 0.5,
    fontSize: 16, color: LIGHT_GRAY, fontFace: 'Arial',
  });
  cover.addText('society6.com/trade', {
    x: 0.6, y: 6.7, w: 4, h: 0.35,
    fontSize: 12, color: LIGHT_GRAY, fontFace: 'Arial',
    hyperlink: { url: 'https://society6.com/trade' },
  });

  // -- Brief summary slide -----------------------------------------------------
  const briefSlide = pptx.addSlide();
  briefSlide.background = { color: BRIEF_BG };
  briefSlide.addText('Project Brief', {
    x: 0.5, y: 0.3, w: 12, h: 0.7,
    fontSize: 26, bold: true, color: DARK_TEXT, fontFace: 'Arial',
  });

  const briefLines = [
    { text: `Client: ${brief.clientName || '\u2014'}`, options: { bold: true } },
    { text: `Project: ${brief.projectName || '\u2014'}`, options: {} },
    { text: `Type: ${brief.projectType || '\u2014'}`, options: {} },
    { text: `Style: ${(brief.styleTags || []).join(', ') || '\u2014'}`, options: {} },
    { text: `Palette: ${(brief.paletteTags || []).join(', ') || '\u2014'}`, options: {} },
    { text: `Avoid: ${(brief.avoidTags || []).join(', ') || '\u2014'}`, options: { color: 'AA3333' } },
    { text: `Rooms: ${(brief.rooms || []).join(', ') || '\u2014'}`, options: {} },
    { text: `Gallery Wall: ${brief.galleryWall ? 'Yes' : 'No'}`, options: {} },
    { text: `Target Pieces: ${brief.targetPieceCount || '\u2014'}`, options: {} },
  ];

  const briefTextArr = briefLines.map(line => ({
    text: line.text + '\n',
    options: { fontSize: 14, color: line.options.color || DARK_TEXT, bold: line.options.bold || false, fontFace: 'Arial' }
  }));

  briefSlide.addText(briefTextArr, {
    x: 0.5, y: 1.2, w: 6, h: 5.5, valign: 'top',
  });

  if (brief.briefSummary) {
    briefSlide.addText(`"${brief.briefSummary}"`, {
      x: 7, y: 1.2, w: 5.8, h: 3,
      fontSize: 15, color: MID_TEXT, fontFace: 'Arial', italic: true,
      valign: 'top',
    });
  }

  // -- Section header helper ---------------------------------------------------
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

  // -- Artwork slide helper ----------------------------------------------------
  async function addArtworkSlide(item, index, sectionLabel) {
    const s = pptx.addSlide();
    s.background = { color: LIGHT_BG };

    // Convert to absolute URL once \u2014 never pass relative/empty URLs to hyperlink
    const productLink = absUrl(item.product_url);

    s.addText(`${sectionLabel} ${index + 1}`, {
      x: 0.2, y: 0.15, w: 2, h: 0.35,
      fontSize: 10, color: 'AAAAAA', fontFace: 'Arial',
    });

    // Artwork image \u2014 fetch as base64 so it works in serverless
    const imgInfo = await fetchImg(item.image_url);
    if (imgInfo && imgInfo.data) {
      const maxW = 3.5;
      const maxH = 3.5;
      let drawW = maxW;
      let drawH = maxW / (imgInfo.aspect || 1);
      if (drawH > maxH) { drawH = maxH; drawW = maxH * (imgInfo.aspect || 1); }
      const drawX = 0.3 + (maxW - drawW) / 2;
      const drawY = 0.6 + (maxH - drawH) / 2;

      const imgOpts = { data: imgInfo.data, x: drawX, y: drawY, w: drawW, h: drawH };
      if (productLink) imgOpts.hyperlink = { url: productLink, tooltip: 'View on Society6' };
      s.addImage(imgOpts);
    } else {
      // Placeholder rect \u2014 no hyperlink on shapes (pptxgenjs bug)
      s.addShape('rect', {
        x: 0.3, y: 0.6, w: 3.5, h: 3.5,
        fill: { color: 'EEEEEE' }, line: { color: 'DDDDDD' },
      });
      s.addText('Image\nunavailable', {
        x: 0.3, y: 1.8, w: 3.5, h: 1,
        fontSize: 11, color: 'AAAAAA', align: 'center', fontFace: 'Arial',
      });
    }

    const rx = 4.2;
    const rw = 8.8;

    s.addText(item.title || 'Untitled', {
      x: rx, y: 0.55, w: rw, h: 1.1,
      fontSize: 20, bold: true, color: DARK_TEXT, fontFace: 'Arial',
      valign: 'top', wrap: true,
    });

    s.addText(item.source_collection || '', {
      x: rx, y: 1.75, w: rw, h: 0.4,
      fontSize: 12, color: '888899', fontFace: 'Arial',
    });

    if (productLink) {
      s.addText('View on Society6 \u2192', {
        x: rx, y: 2.25, w: 4.5, h: 0.45,
        fontSize: 14, color: S6_RED, bold: true, fontFace: 'Arial',
        hyperlink: { url: productLink },
      });
      s.addText(productLink, {
        x: rx, y: 2.8, w: rw, h: 0.35,
        fontSize: 9, color: LINK_BLUE, fontFace: 'Arial',
        hyperlink: { url: productLink },
      });
    } else {
      s.addText(item.product_url || '', {
        x: rx, y: 2.8, w: rw, h: 0.35,
        fontSize: 9, color: LINK_BLUE, fontFace: 'Arial',
      });
    }

    if (item.reason) {
      s.addText(`Why this fits: ${item.reason}`, {
        x: rx, y: 3.3, w: rw, h: 1.0,
        fontSize: 12, color: MID_TEXT, fontFace: 'Arial', italic: true,
        valign: 'top', wrap: true,
      });
    }

    if (item.pinned) {
      s.addText('Pinned by curator', {
        x: rx, y: 4.5, w: 4, h: 0.35,
        fontSize: 10, color: '3060AA', fontFace: 'Arial',
      });
    }
  }

  // -- Primary Collection ------------------------------------------------------
  if (primary.length > 0) {
    addSectionHeader('Primary Collection', `${primary.length} curated selections`);
    for (let i = 0; i < primary.length; i++) {
      await addArtworkSlide(primary[i], i, 'P');
    }
  }

  // -- Accent & Alternates -----------------------------------------------------
  if (accent.length > 0) {
    addSectionHeader('Accent & Alternates', `${accent.length} additional options`);
    for (let i = 0; i < accent.length; i++) {
      await addArtworkSlide(accent[i], i, 'A');
    }
  }

  // -- Gallery Wall Sets -------------------------------------------------------
  if (galleryWallSets.length > 0) {
    addSectionHeader('Gallery Wall Sets', 'Suggested groupings for gallery walls');
    for (const setObj of galleryWallSets) {
      const s = pptx.addSlide();
      s.background = { color: LIGHT_BG };
      s.addText(`Gallery Wall Set ${setObj.setNumber}${setObj.theme ? ': ' + setObj.theme : ''}`, {
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
        const gwImg = await fetchImg(item.image_url);
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

  // -- Generate base64 output -------------------------------------------------
  const pptxBase64 = await pptx.write({ outputType: 'base64' });
  const slug = (brief.projectName || 'S6-Curation').replace(/[^a-z0-9]/gi, '-').replace(/-+/g, '-');
  const filename = `${slug}-Society6.pptx`;

  return { pptxBase64, filename };
}
