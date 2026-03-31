import PptxGenJS from 'pptxgenjs';

const C = {
  dark:   '1C1C2E',
  light:  'F5F5F5',
  white:  'FFFFFF',
  accent: 'E8472B',
  muted:  '9BA3AF',
  body:   '2D2D2D',
};

function safeName(str) {
  return (str || 'S6-Curation').replace(/[^a-zA-Z0-9\s-]/g, '').trim();
}

function makeAccentBar(slide) {
  slide.addShape('rect', { x: 0, y: 0, w: 0.18, h: 5.625, fill: { color: C.accent }, line: { color: C.accent } });
}

function addCoverSlide(pres, brief) {
  const slide = pres.addSlide();
  slide.background = { color: C.dark };
  slide.addShape('rect', { x: 0, y: 5.1, w: 10, h: 0.525, fill: { color: C.accent }, line: { color: C.accent } });
  slide.addText('SOCIETY6 TRADE CURATION', { x: 0.6, y: 1.2, w: 8.8, h: 0.4, fontSize: 11, fontFace: 'Calibri', color: C.muted, charSpacing: 4 });
  slide.addText(brief.projectName || 'Wall Art Curation', { x: 0.6, y: 1.75, w: 8.8, h: 1.6, fontSize: 44, fontFace: 'Georgia', color: C.white, bold: true });
  const subtitle = [
    brief.projectType ? brief.projectType.replace(/_/g, ' ').toUpperCase() : '',
    new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
  ].filter(Boolean).join('  ·  ');
  slide.addText(subtitle, { x: 0.6, y: 3.5, w: 8.8, h: 0.5, fontSize: 14, fontFace: 'Calibri', color: C.muted });
}

function addBriefSlide(pres, brief) {
  const slide = pres.addSlide();
  slide.background = { color: C.light };
  makeAccentBar(slide);
  slide.addText('Project Brief', { x: 0.5, y: 0.35, w: 9, h: 0.7, fontSize: 28, fontFace: 'Georgia', color: C.body, bold: true, margin: 0 });
  const rows = [
    ['Project',       brief.projectName  || '—'],
    ['Type',          (brief.projectType || '—').replace(/_/g, ' ')],
    ['Style',         (brief.styleTags   || []).join(', ') || '—'],
    ['Palette',       (brief.paletteTags || []).join(', ') || '—'],
    ['Avoid',         (brief.avoidTags   || []).join(', ') || '—'],
    ['Rooms',         (brief.roomNeeds   || []).join(', ') || '—'],
    ['Gallery Wall',  brief.galleryWall ? 'Yes' : 'No'],
    ['Target Pieces', String(brief.targetPieceCount || '—')],
  ];
  rows.forEach(([label, value], i) => {
    const y = 1.25 + i * 0.48;
    slide.addText(label.toUpperCase(), { x: 0.5, y, w: 2.2, h: 0.38, fontSize: 9, fontFace: 'Calibri', color: C.muted, bold: true, charSpacing: 1.5, valign: 'middle' });
    slide.addText(value, { x: 2.8, y, w: 6.8, h: 0.38, fontSize: 13, fontFace: 'Calibri', color: C.body, valign: 'middle' });
    if (i < rows.length - 1) {
      slide.addShape('rect', { x: 0.5, y: y + 0.4, w: 9.1, h: 0.01, fill: { color: 'E2E8F0' }, line: { color: 'E2E8F0' } });
    }
  });
}

function addSectionHeader(pres, title) {
  const slide = pres.addSlide();
  slide.background = { color: C.dark };
  slide.addShape('rect', { x: 0.6, y: 2.55, w: 1.2, h: 0.06, fill: { color: C.accent }, line: { color: C.accent } });
  slide.addText(title, { x: 0.6, y: 2.7, w: 8.8, h: 1.0, fontSize: 36, fontFace: 'Georgia', color: C.white, bold: true });
}

function addArtworkSlide(pres, item, index, sectionLabel) {
  const slide = pres.addSlide();
  slide.background = { color: C.light };
  slide.addShape('rect', { x: 0, y: 0, w: 3.8, h: 5.625, fill: { color: '2D2D3E' }, line: { color: '2D2D3E' } });
  slide.addText(String(index + 1).padStart(2, '0'), { x: 0.25, y: 0.3, w: 1, h: 0.5, fontSize: 11, fontFace: 'Calibri', color: C.muted, bold: true });
  slide.addText(sectionLabel.toUpperCase(), { x: 0.25, y: 0.85, w: 3.2, h: 0.35, fontSize: 8, fontFace: 'Calibri', color: C.muted, charSpacing: 2 });
  slide.addText(item.title || 'Untitled', { x: 0.25, y: 1.3, w: 3.3, h: 2.4, fontSize: 18, fontFace: 'Georgia', color: C.white, bold: true, valign: 'top' });
  const collection = (item.source_collection || '').replace('/collections/', '');
  slide.addText(collection.toUpperCase(), { x: 0.25, y: 3.85, w: 3.3, h: 0.35, fontSize: 8, fontFace: 'Calibri', color: C.muted, charSpacing: 1.5 });
  slide.addShape('rect', { x: 0, y: 5.2, w: 3.8, h: 0.425, fill: { color: C.accent }, line: { color: C.accent } });
  slide.addText('VIEW ON SOCIETY6 \u2192', { x: 0.25, y: 5.22, w: 3.3, h: 0.38, fontSize: 9, fontFace: 'Calibri', color: C.white, bold: true, hyperlink: { url: item.product_url || 'https://society6.com' } });
  slide.addText('PRODUCT URL', { x: 4.1, y: 0.5, w: 5.6, h: 0.35, fontSize: 9, fontFace: 'Calibri', color: C.muted, bold: true, charSpacing: 1.5 });
  slide.addText(item.product_url || '', { x: 4.1, y: 0.9, w: 5.6, h: 0.45, fontSize: 10, fontFace: 'Calibri', color: '0066CC', hyperlink: { url: item.product_url || 'https://society6.com' } });
  slide.addShape('rect', { x: 4.1, y: 1.45, w: 5.6, h: 0.012, fill: { color: 'E2E8F0' }, line: { color: 'E2E8F0' } });
  slide.addShape('rect', { x: 4.1, y: 1.6, w: 5.5, h: 3.4, fill: { color: 'E8EDF2' }, line: { color: 'D1D9E0', width: 1 } });
  slide.addText('[ Click link above to view artwork ]', { x: 4.1, y: 1.6, w: 5.5, h: 3.4, fontSize: 10, fontFace: 'Calibri', color: C.muted, align: 'center', valign: 'middle' });
}

function addGallerySetSlide(pres, setObj, index) {
  const slide = pres.addSlide();
  slide.background = { color: C.light };
  makeAccentBar(slide);
  const setTitle = 'Gallery Wall Set ' + (setObj.setNumber || index + 1) + (setObj.theme ? ' \u2014 ' + setObj.theme : '');
  slide.addText(setTitle, { x: 0.5, y: 0.3, w: 9, h: 0.65, fontSize: 24, fontFace: 'Georgia', color: C.body, bold: true, margin: 0 });
  (setObj.items || []).slice(0, 6).forEach((item, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 0.5 + col * 4.7;
    const y = 1.2 + row * 1.35;
    slide.addShape('rect', { x, y, w: 4.4, h: 1.2, fill: { color: 'FFFFFF' }, line: { color: 'E2E8F0', width: 1 }, shadow: { type: 'outer', color: '000000', blur: 4, offset: 2, angle: 135, opacity: 0.08 } });
    slide.addText(item.title || 'Untitled', { x: x + 0.15, y: y + 0.1, w: 4.1, h: 0.45, fontSize: 11, fontFace: 'Calibri', color: C.body, bold: true, margin: 0 });
    slide.addText(item.product_url || '', { x: x + 0.15, y: y + 0.62, w: 4.1, h: 0.38, fontSize: 8, fontFace: 'Calibri', color: '0066CC', hyperlink: { url: item.product_url || 'https://society6.com' } });
  });
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { brief = {}, primary = [], accent = [], galleryWallSets = [] } = body;

    const pres = new PptxGenJS();
    pres.layout = 'LAYOUT_16x9';
    pres.title = (brief.projectName || 'S6 Trade Curation') + ' \u2014 Society6';

    addCoverSlide(pres, brief);
    addBriefSlide(pres, brief);

    if (primary.length > 0) {
      addSectionHeader(pres, 'Primary Collection');
      primary.slice(0, 8).forEach((item, i) => addArtworkSlide(pres, item, i, 'Primary'));
    }
    if (accent.length > 0) {
      addSectionHeader(pres, 'Accent & Alternates');
      accent.slice(0, 6).forEach((item, i) => addArtworkSlide(pres, item, i, 'Accent'));
    }
    if (galleryWallSets.length > 0) {
      addSectionHeader(pres, 'Gallery Wall Sets');
      galleryWallSets.forEach((set, i) => addGallerySetSlide(pres, set, i));
    }

    const buffer = await pres.write({ outputType: 'nodebuffer' });
    const filename = safeName(brief.projectName) + '-Society6.pptx';

    return Response.json({
      success: true,
      pptxBase64: Buffer.from(buffer).toString('base64'),
      filename,
    });

  } catch (error) {
    console.error('PPTX generation error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}
