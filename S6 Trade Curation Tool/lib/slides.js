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

export async function createSlidesDeck(brief, { primary = [], accent = [], galleryWallSets = [] }) {
  const PptxGenJS = (await import('pptxgenjs')).default;
  const pptx = new PptxGenJS();

  pptx.layout = 'LAYOUT_WIDE'; // 13.33" x 7.5"
  pptx.title = `${brief.projectName || 'S6 Trade Curation'} — Society6 Recommendations`;
  pptx.author = 'Society6 Trade Team';

  const date = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  // ── Cover slide ─────────────────────────────────────────────────────────────
  const cover = pptx.addSlide();
  cover.background = { color: DARK_BG };
  cover.addText(brief.projectName || 'Trade Curation', {
    x: 0.6, y: 2.4, w: 12, h: 1.1,
    fontSize: 44, bold: true, color: WHITE, fontFace: 'Arial',
  });
  cover.addText(`Society6 Wall Art Curation  •  ${date}`, {
    x: 0.6, y: 3.65, w: 10, h: 0.5,
    fontSize: 16, color: LIGHT_GRAY, fontFace: 'Arial',
  });
  cover.addText('society6.com/trade', {
    x: 0.6, y: 6.7, w: 4, h: 0.35,
    fontSize: 12, color: LIGHT_GRAY, fontFace: 'Arial',
    hyperlink: { url: 'https://society6.com/trade' },
  });

  // ── Brief summary slide ─────────────────────────────────────────────────────
  const briefSlide = pptx.addSlide();
  briefSlide.background = { color: BRIEF_BG };
  briefSlide.addText('Project Brief', {
    x: 0.5, y: 0.3, w: 12, h: 0.7,
    fontSize: 26, bold: true, color: DARK_TEXT, fontFace: 'Arial',
  });

  const briefLines = [
    { text: `Project: ${brief.projectName || '—'}`, options: { bold: true } },
    { text: `Type: ${brief.projectType || '—'}`, options: {} },
    { text: `Style: ${(brief.styleTags || []).join(', ') || '—'}`, options: {} },
    { text: `Palette: ${(brief.paletteTags || []).join(', ') || '—'}`, options: {} },
    { text: `Avoid: ${(brief.avoidTags || []).join(', ') || '—'}`, options: { color: 'AA3333' } },
    { text: `Rooms: ${(brief.rooms || []).join(', ') || '—'}`, options: {} },
    { text: `Gallery Wall: ${brief.galleryWall ? 'Yes' : 'No'}`, options: {} },
    { text: `Target Pieces: ${brief.targetPieceCount || '—'}`, options: {} },
  ].filter(Boolean);

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

  // ── Section header helper ───────────────────────────────────────────────────
  function addSectionHeader(label, subtitle = '') {
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

  // ── Artwork slide helper ────────────────────────────────────────────────────
  function addArtworkSlide(item, index, sectionLabel) {
    const s = pptx.addSlide();
    s.background = { color: LIGHT_BG };

    // Index badge (top left)
    s.addText(`${sectionLabel} ${index + 1}`, {
      x: 0.2, y: 0.15, w: 2, h: 0.35,
      fontSize: 10, color: 'AAAAAA', fontFace: 'Arial',
    });

    // Artwork image (left side) — clickable link to product page
    if (item.image_url) {
      try {
        s.addImage({
          path: item.image_url,
          x: 0.3, y: 0.6, w: 3.5, h: 3.5,
          hyperlink: { url: item.product_url || item.image_url },
        });
      } catch (e) {
        // If image fails, add a placeholder box
        s.addShape('rect', {
          x: 0.3, y: 0.6, w: 3.5, h: 3.5,
          fill: { color: 'EEEEEE' }, line: { color: 'DDDDDD' },
        });
        s.addText('Image\nunavailable', {
          x: 0.3, y: 1.8, w: 3.5, h: 1,
          fontSize: 11, color: 'AAAAAA', align: 'center', fontFace: 'Arial',
        });
      }
    }

    // Right side content
    const rx = 4.2; // right column x position
    const rw = 8.8;  // right column width

    // Title — large and prominent
    s.addText(item.title || 'Untitled', {
      x: rx, y: 0.55, w: rw, h: 1.1,
      fontSize: 20, bold: true, color: DARK_TEXT, fontFace: 'Arial',
      valign: 'top', wrap: true,
    });

    // Collection
    s.addText(item.source_collection || '', {
      x: rx, y: 1.75, w: rw, h: 0.4,
      fontSize: 12, color: '888899', fontFace: 'Arial',
    });

    // "View on Society6" — red, clickable
    s.addText('View on Society6 →', {
      x: rx, y: 2.25, w: 4.5, h: 0.45,
      fontSize: 14, color: S6_RED, bold: true, fontFace: 'Arial',
      hyperlink: { url: item.product_url },
    });

    // Product URL in small text (also clickable)
    s.addText(item.product_url || '', {
      x: rx, y: 2.8, w: rw, h: 0.35,
      fontSize: 9, color: LINK_BLUE, fontFace: 'Arial',
      hyperlink: { url: item.product_url },
    });

    // Rationale (Claude's reason for selecting this piece)
    if (item.reason) {
      s.addText(`Why this fits: ${item.reason}`, {
        x: rx, y: 3.3, w: rw, h: 1.0,
        fontSize: 12, color: MID_TEXT, fontFace: 'Arial', italic: true,
        valign: 'top', wrap: true,
      });
    }

    // Pinned indicator
    if (item.pinned) {
      s.addText('📌 Pinned by curator', {
        x: rx, y: 4.5, w: 4, h: 0.35,
        fontSize: 10, color: '3060AA', fontFace: 'Arial',
      });
    }
  }

  // ── Primary Collection ──────────────────────────────────────────────────────
  if (primary.length > 0) {
    addSectionHeader('Primary Collection', `${primary.length} curated selections`);
    primary.forEach((item, i) => addArtworkSlide(item, i, 'P'));
  }

  // ── Accent & Alternates ─────────────────────────────────────────────────────
  if (accent.length > 0) {
    addSectionHeader('Accent & Alternates', `${accent.length} additional options`);
    accent.forEach((item, i) => addArtworkSlide(item, i, 'A'));
  }

  // ── Gallery Wall Sets ───────────────────────────────────────────────────────
  if (galleryWallSets.length > 0) {
    addSectionHeader('Gallery Wall Sets', 'Suggested groupings for gallery walls');
    galleryWallSets.forEach((setObj) => {
      const s = pptx.addSlide();
      s.background = { color: LIGHT_BG };
      s.addText(`Gallery Wall Set ${setObj.setNumber}${setObj.theme ? ': ' + setObj.theme : ''}`, {
        x: 0.4, y: 0.2, w: 12, h: 0.6,
        fontSize: 22, bold: true, color: DARK_TEXT, fontFace: 'Arial',
      });
      const items = setObj.items || [];
      items.forEach((item, i) => {
        const col = i % 3;
        const row = Math.floor(i / 3);
        const cx = 0.4 + col * 4.3;
        const cy = 1.0 + row * 3.2;
        if (item.image_url) {
          try {
            s.addImage({ path: item.image_url, x: cx, y: cy, w: 3.8, h: 2.5,
              hyperlink: { url: item.product_url } });
          } catch {}
        }
        s.addText(item.title || '', {
          x: cx, y: cy + 2.55, w: 3.8, h: 0.45,
          fontSize: 8, color: DARK_TEXT, fontFace: 'Arial',
          hyperlink: { url: item.product_url },
        });
      });
    });
  }

  // ── Generate base64 output ─────────────────────────────────────────────────
  const pptxBase64 = await pptx.write({ outputType: 'base64' });
  const slug = (brief.projectName || 'S6-Curation').replace(/[^a-z0-9]/gi, '-').replace(/-+/g, '-');
  const filename = `${slug}-Society6.pptx`;

  return { pptxBase64, filename };
}
