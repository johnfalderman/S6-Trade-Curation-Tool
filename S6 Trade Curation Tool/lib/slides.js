/**
 * slides.js
 * Google Slides deck generator for S6 Trade Curation Tool.
 *
 * SETUP:
 * 1. Create a Google Cloud project and enable the Slides API + Drive API
 * 2. Create a Service Account and download the JSON key
 * 3. Base64-encode the key: cat key.json | base64
 * 4. Set GOOGLE_SERVICE_ACCOUNT_KEY=<base64 string> in .env.local
 */

// ---- Slide layout constants (EMU = English Metric Units, 914400 per inch) ----
const SLIDE_WIDTH = 9144000;  // 10 inches
const SLIDE_HEIGHT = 5143500; // 7.5 inches (but Slides default is 5143500 = 7.5in? Actually standard is 7.5in = 6858000 EMU. Let's use Google Slides default: 9144000 x 5143500)

const COLORS = {
  background: { red: 0.98, green: 0.98, blue: 0.95 },
  dark: { red: 0.10, green: 0.10, blue: 0.10 },
  accent: { red: 0.91, green: 0.28, blue: 0.33 },
  white: { red: 1, green: 1, blue: 1 },
  gray: { red: 0.55, green: 0.55, blue: 0.55 },
  lightgray: { red: 0.90, green: 0.90, blue: 0.90 },
};

// ---- Helpers ----
function pt(points) {
  return points * 12700; // points to EMU
}

function makeTextBox(id, text, x, y, w, h, opts = {}) {
  const requests = [
    {
      createShape: {
        objectId: id,
        shapeType: 'TEXT_BOX',
        elementProperties: {
          pageObjectId: opts.pageId,
          size: { width: { magnitude: w, unit: 'EMU' }, height: { magnitude: h, unit: 'EMU' } },
          transform: { scaleX: 1, scaleY: 1, translateX: x, translateY: y, unit: 'EMU' },
        },
      },
    },
    {
      insertText: { objectId: id, text },
    },
  ];

  const styleOpts = {};
  if (opts.fontSize) styleOpts.fontSize = { magnitude: opts.fontSize, unit: 'PT' };
  if (opts.bold) styleOpts.bold = true;
  if (opts.color) styleOpts.foregroundColor = { opaqueColor: { rgbColor: opts.color } };
  if (opts.link) styleOpts.link = { url: opts.link };

  if (Object.keys(styleOpts).length > 0) {
    requests.push({
      updateTextStyle: {
        objectId: id,
        style: styleOpts,
        fields: Object.keys(styleOpts).join(','),
      },
    });
  }

  if (opts.alignment) {
    requests.push({
      updateParagraphStyle: {
        objectId: id,
        style: { alignment: opts.alignment },
        fields: 'alignment',
      },
    });
  }

  return requests;
}

function makeFillColor(pageId, color) {
  return {
    updatePageProperties: {
      objectId: pageId,
      pageProperties: {
        pageBackgroundFill: {
          solidFill: { color: { rgbColor: color } },
        },
      },
      fields: 'pageBackgroundFill',
    },
  };
}

function makeImage(id, url, x, y, w, h, pageId) {
  return {
    createImage: {
      objectId: id,
      url,
      elementProperties: {
        pageObjectId: pageId,
        size: { width: { magnitude: w, unit: 'EMU' }, height: { magnitude: h, unit: 'EMU' } },
        transform: { scaleX: 1, scaleY: 1, translateX: x, translateY: y, unit: 'EMU' },
      },
    },
  };
}

// ---- Slide builders ----

function buildCoverSlide(brief, existingSlideId) {
  const pageId = existingSlideId || 'slide_cover';
  const requests = [makeFillColor(pageId, COLORS.dark)];

  // Title
  requests.push(...makeTextBox(
    `${pageId}_title`, 'Wall Art Curation',
    pt(72), pt(120), SLIDE_WIDTH - pt(144), pt(60),
    { pageId, fontSize: 36, bold: true, color: COLORS.white, alignment: 'CENTER' }
  ));

  // Project name
  requests.push(...makeTextBox(
    `${pageId}_project`, brief.projectName,
    pt(72), pt(195), SLIDE_WIDTH - pt(144), pt(50),
    { pageId, fontSize: 28, color: COLORS.accent, alignment: 'CENTER' }
  ));

  // Type + date
  const typeLabel = brief.projectType.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
  const date = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  requests.push(...makeTextBox(
    `${pageId}_meta`, `${typeLabel}  ·  ${date}`,
    pt(72), pt(265), SLIDE_WIDTH - pt(144), pt(36),
    { pageId, fontSize: 16, color: COLORS.gray, alignment: 'CENTER' }
  ));

  // Society6 credit
  requests.push(...makeTextBox(
    `${pageId}_credit`, 'Curated from Society6',
    pt(72), SLIDE_HEIGHT - pt(60), SLIDE_WIDTH - pt(144), pt(30),
    { pageId, fontSize: 13, color: COLORS.gray, alignment: 'CENTER' }
  ));

  return requests;
}

function buildBriefSlide(brief, pageId) {
  const requests = [makeFillColor(pageId, COLORS.background)];

  // Header
  requests.push(...makeTextBox(
    `${pageId}_hdr`, 'Project Brief',
    pt(48), pt(36), SLIDE_WIDTH - pt(96), pt(44),
    { pageId, fontSize: 24, bold: true, color: COLORS.dark }
  ));

  const lines = [
    `Project: ${brief.projectName}`,
    `Type: ${brief.projectType.replace('_', ' ')}`,
    brief.styleTags.length ? `Style: ${brief.styleTags.join(', ')}` : null,
    brief.paletteTags.length ? `Palette: ${brief.paletteTags.join(', ')}` : null,
    brief.avoidTags.length ? `Avoid: ${brief.avoidTags.join(', ')}` : null,
    brief.rooms.length ? `Spaces: ${brief.rooms.join(', ')}` : null,
    brief.galleryWall ? 'Gallery Wall: Yes' : null,
    brief.pieceCount ? `Target Pieces: ${brief.pieceCount}` : null,
  ].filter(Boolean);

  requests.push(...makeTextBox(
    `${pageId}_body`, lines.join('\n'),
    pt(48), pt(100), SLIDE_WIDTH - pt(96), SLIDE_HEIGHT - pt(160),
    { pageId, fontSize: 18, color: COLORS.dark }
  ));

  return requests;
}

/**
 * Build a grid slide with up to 4 artworks (2×2).
 */
function buildArtworkGridSlide(artworks, slideLabel, pageId) {
  const requests = [makeFillColor(pageId, COLORS.background)];

  // Section label
  requests.push(...makeTextBox(
    `${pageId}_lbl`, slideLabel,
    pt(32), pt(18), SLIDE_WIDTH - pt(64), pt(32),
    { pageId, fontSize: 13, color: COLORS.gray }
  ));

  const grid = [
    { x: pt(32), y: pt(60) },
    { x: SLIDE_WIDTH / 2 + pt(16), y: pt(60) },
    { x: pt(32), y: SLIDE_HEIGHT / 2 + pt(16) },
    { x: SLIDE_WIDTH / 2 + pt(16), y: SLIDE_HEIGHT / 2 + pt(16) },
  ];

  const cellW = SLIDE_WIDTH / 2 - pt(48);
  const cellH = SLIDE_HEIGHT / 2 - pt(80);
  const imgH = cellH - pt(50);

  artworks.slice(0, 4).forEach((art, i) => {
    const pos = grid[i];
    const imgId = `${pageId}_img${i}`;
    const titleId = `${pageId}_title${i}`;
    const urlId = `${pageId}_url${i}`;

    // Image
    if (art.image_url) {
      requests.push(makeImage(imgId, art.image_url, pos.x, pos.y, cellW, imgH, pageId));
    }

    // Title
    const titleText = (art.title || 'Untitled').slice(0, 50);
    requests.push(...makeTextBox(
      titleId, titleText,
      pos.x, pos.y + imgH + pt(4), cellW, pt(22),
      { pageId, fontSize: 11, bold: true, color: COLORS.dark }
    ));

    // URL (clickable)
    const urlText = 'View on Society6 →';
    requests.push(...makeTextBox(
      urlId, urlText,
      pos.x, pos.y + imgH + pt(28), cellW, pt(18),
      { pageId, fontSize: 10, color: COLORS.accent, link: art.product_url }
    ));
  });

  return requests;
}

function buildGalleryWallSlide(gwSet, pageId) {
  const requests = [makeFillColor(pageId, COLORS.background)];

  requests.push(...makeTextBox(
    `${pageId}_lbl`, `Gallery Wall Set ${gwSet.setNumber}  ·  ${gwSet.theme}`,
    pt(32), pt(18), SLIDE_WIDTH - pt(64), pt(32),
    { pageId, fontSize: 13, color: COLORS.gray }
  ));

  // 3 columns × 2 rows for up to 6 items
  const cols = 3;
  const rows = 2;
  const colW = (SLIDE_WIDTH - pt(80)) / cols;
  const rowH = (SLIDE_HEIGHT - pt(80)) / rows;
  const imgH = rowH - pt(48);
  const padding = pt(12);

  gwSet.items.slice(0, 6).forEach((art, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = pt(32) + col * colW + (col > 0 ? padding : 0);
    const y = pt(56) + row * rowH + (row > 0 ? padding : 0);

    const imgId = `${pageId}_img${i}`;
    const titleId = `${pageId}_ttl${i}`;
    const urlId = `${pageId}_url${i}`;

    if (art.image_url) {
      requests.push(makeImage(imgId, art.image_url, x, y, colW - padding, imgH, pageId));
    }

    const titleText = (art.title || 'Untitled').slice(0, 35);
    requests.push(...makeTextBox(
      titleId, titleText,
      x, y + imgH + pt(2), colW - padding, pt(18),
      { pageId, fontSize: 9, bold: true, color: COLORS.dark }
    ));

    requests.push(...makeTextBox(
      urlId, 'View →',
      x, y + imgH + pt(22), colW - padding, pt(14),
      { pageId, fontSize: 8, color: COLORS.accent, link: art.product_url }
    ));
  });

  return requests;
}

// ---- Main export ----

/**
 * Create a Google Slides deck from recommendations.
 * Returns the deck URL.
 * Throws if GOOGLE_SERVICE_ACCOUNT_KEY is not set.
 */
async function createSlidesDeck(brief, recommendations) {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY not configured');
  }

  const { google } = require('googleapis');

  let credentials;
  try {
    const keyJson = Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_KEY, 'base64').toString('utf8');
    credentials = JSON.parse(keyJson);
  } catch (e) {
    throw new Error('Invalid GOOGLE_SERVICE_ACCOUNT_KEY — must be base64-encoded service account JSON');
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: [
      'https://www.googleapis.com/auth/presentations',
      'https://www.googleapis.com/auth/drive',
    ],
  });

  const slides = google.slides({ version: 'v1', auth });
  const drive = google.drive({ version: 'v3', auth });

  // 1. Create blank presentation
  const createRes = await slides.presentations.create({
    requestBody: { title: `S6 Curation — ${brief.projectName}` },
  });
  const presentationId = createRes.data.presentationId;
  const firstSlideId = createRes.data.slides[0].objectId;

  // 2. Build all slide update requests
  const batchRequests = [];
  const slideIds = [];

  // Cover slide (reuse the default first slide)
  batchRequests.push(...buildCoverSlide(brief, firstSlideId));
  slideIds.push(firstSlideId);

  // Brief slide
  const briefSlideId = 'slide_brief';
  batchRequests.push({ duplicateObject: { objectId: firstSlideId, objectIds: { [firstSlideId]: briefSlideId } } });
  batchRequests.push(...buildBriefSlide(brief, briefSlideId));

  // Primary collection slides (4 per slide)
  const { primary = [], accent = [], galleryWallSets = [] } = recommendations;
  const primaryChunks = chunkArray(primary, 4);
  primaryChunks.forEach((chunk, i) => {
    const id = `slide_primary_${i}`;
    batchRequests.push({ duplicateObject: { objectId: firstSlideId, objectIds: { [firstSlideId]: id } } });
    batchRequests.push(...buildArtworkGridSlide(chunk, `Primary Collection (${i + 1}/${primaryChunks.length})`, id));
  });

  // Accent slides
  const accentChunks = chunkArray(accent, 4);
  accentChunks.forEach((chunk, i) => {
    const id = `slide_accent_${i}`;
    batchRequests.push({ duplicateObject: { objectId: firstSlideId, objectIds: { [firstSlideId]: id } } });
    batchRequests.push(...buildArtworkGridSlide(chunk, `Accent & Alternates (${i + 1}/${accentChunks.length})`, id));
  });

  // Gallery wall slides
  galleryWallSets.forEach((gwSet) => {
    const id = `slide_gw_${gwSet.setNumber}`;
    batchRequests.push({ duplicateObject: { objectId: firstSlideId, objectIds: { [firstSlideId]: id } } });
    batchRequests.push(...buildGalleryWallSlide(gwSet, id));
  });

  // 3. Execute batch update
  await slides.presentations.batchUpdate({
    presentationId,
    requestBody: { requests: batchRequests },
  });

  // 4. Make publicly accessible (anyone with link can view)
  await drive.permissions.create({
    fileId: presentationId,
    requestBody: { role: 'reader', type: 'anyone' },
  });

  // Optional: move to a specific folder
  if (process.env.GOOGLE_DRIVE_FOLDER_ID) {
    await drive.files.update({
      fileId: presentationId,
      addParents: process.env.GOOGLE_DRIVE_FOLDER_ID,
    });
  }

  return {
    url: `https://docs.google.com/presentation/d/${presentationId}/edit`,
    presentationId,
  };
}

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

module.exports = { createSlidesDeck };
