import { google } from 'googleapis';

/**
 * Authenticate using the full service account JSON stored as base64.
 * Set in Netlify:
 *   GOOGLE_SERVICE_ACCOUNT_JSON — the entire service account JSON file, base64-encoded
 *
 * To get the base64 value, run in Terminal:
 *   base64 -i ~/path/to/service-account.json | tr -d '\n' | pbcopy
 */
async function getAuth() {
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!b64) throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_JSON env var');

  const credentials = JSON.parse(
    Buffer.from(b64, 'base64').toString('utf8')
  );

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: [
      'https://www.googleapis.com/auth/presentations',
      'https://www.googleapis.com/auth/drive',
    ],
  });

  return auth.getClient();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function rgb(r, g, b) {
  return { red: r / 255, green: g / 255, blue: b / 255 };
}

function pt(n) { return { magnitude: n, unit: 'PT' }; }

function textStyle(opts = {}) {
  return {
    bold: opts.bold || false,
    fontSize: opts.fontSize ? pt(opts.fontSize) : pt(12),
    foregroundColor: { opaqueColor: { rgbColor: opts.color || rgb(30, 30, 30) } },
    fontFamily: opts.font || 'Lato',
  };
}

function solidFill(r, g, b) {
  return { solidFill: { color: { rgbColor: rgb(r, g, b) } } };
}

// ─── Slide builders ───────────────────────────────────────────────────────────

/** Cover slide */
function makeCoverSlide(presentationId, brief) {
  const slideId = 'cover';
  const titleId = 'coverTitle';
  const subId = 'coverSub';

  return [
    // Create blank slide
    { createSlide: { objectId: slideId, slideLayoutReference: { predefinedLayout: 'BLANK' } } },
    // Dark background
    { updatePageProperties: {
      objectId: slideId,
      pageProperties: { pageBackgroundFill: solidFill(20, 20, 30) },
      fields: 'pageBackgroundFill',
    }},
    // Title text box
    { createShape: {
      objectId: titleId,
      shapeType: 'TEXT_BOX',
      elementProperties: {
        pageObjectId: slideId,
        size: { width: pt(540), height: pt(80) },
        transform: { scaleX: 1, scaleY: 1, translateX: 30, translateY: 100, unit: 'PT' },
      },
    }},
    { insertText: { objectId: titleId, text: brief.projectName || 'Trade Curation' } },
    { updateTextStyle: {
      objectId: titleId,
      style: textStyle({ bold: true, fontSize: 36, color: rgb(255, 255, 255) }),
      fields: 'bold,fontSize,foregroundColor,fontFamily',
    }},
    // Subtitle
    { createShape: {
      objectId: subId,
      shapeType: 'TEXT_BOX',
      elementProperties: {
        pageObjectId: slideId,
        size: { width: pt(540), height: pt(50) },
        transform: { scaleX: 1, scaleY: 1, translateX: 30, translateY: 190, unit: 'PT' },
      },
    }},
    { insertText: { objectId: subId, text: `Society6 Wall Art Curation  •  ${new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}` } },
    { updateTextStyle: {
      objectId: subId,
      style: textStyle({ fontSize: 14, color: rgb(180, 180, 200) }),
      fields: 'bold,fontSize,foregroundColor,fontFamily',
    }},
  ];
}

/** Brief summary slide */
function makeBriefSlide(presentationId, brief) {
  const slideId = 'briefSlide';
  const titleId = 'briefTitle';
  const bodyId = 'briefBody';

  const lines = [
    `Project: ${brief.projectName || '—'}`,
    `Type: ${brief.projectType || '—'}`,
    `Style: ${(brief.styleTags || []).join(', ') || '—'}`,
    `Palette: ${(brief.paletteTags || []).join(', ') || '—'}`,
    `Avoid: ${(brief.avoidTags || []).join(', ') || '—'}`,
    `Rooms: ${(brief.roomNeeds || []).join(', ') || '—'}`,
    `Gallery Wall: ${brief.galleryWall ? 'Yes' : 'No'}`,
    `Target Pieces: ${brief.targetPieceCount || '—'}`,
  ].join('\n');

  return [
    { createSlide: { objectId: slideId, slideLayoutReference: { predefinedLayout: 'BLANK' } } },
    { updatePageProperties: {
      objectId: slideId,
      pageProperties: { pageBackgroundFill: solidFill(245, 245, 248) },
      fields: 'pageBackgroundFill',
    }},
    { createShape: {
      objectId: titleId,
      shapeType: 'TEXT_BOX',
      elementProperties: {
        pageObjectId: slideId,
        size: { width: pt(540), height: pt(40) },
        transform: { scaleX: 1, scaleY: 1, translateX: 30, translateY: 20, unit: 'PT' },
      },
    }},
    { insertText: { objectId: titleId, text: 'Project Brief' } },
    { updateTextStyle: {
      objectId: titleId,
      style: textStyle({ bold: true, fontSize: 22, color: rgb(30, 30, 50) }),
      fields: 'bold,fontSize,foregroundColor,fontFamily',
    }},
    { createShape: {
      objectId: bodyId,
      shapeType: 'TEXT_BOX',
      elementProperties: {
        pageObjectId: slideId,
        size: { width: pt(540), height: pt(300) },
        transform: { scaleX: 1, scaleY: 1, translateX: 30, translateY: 70, unit: 'PT' },
      },
    }},
    { insertText: { objectId: bodyId, text: lines } },
    { updateTextStyle: {
      objectId: bodyId,
      style: textStyle({ fontSize: 13, color: rgb(60, 60, 80) }),
      fields: 'bold,fontSize,foregroundColor,fontFamily',
    }},
  ];
}

/** Section header slide (e.g. "Primary Collection") */
function makeSectionHeaderSlide(slideId, label) {
  const titleId = `${slideId}_title`;
  return [
    { createSlide: { objectId: slideId, slideLayoutReference: { predefinedLayout: 'BLANK' } } },
    { updatePageProperties: {
      objectId: slideId,
      pageProperties: { pageBackgroundFill: solidFill(30, 30, 50) },
      fields: 'pageBackgroundFill',
    }},
    { createShape: {
      objectId: titleId,
      shapeType: 'TEXT_BOX',
      elementProperties: {
        pageObjectId: slideId,
        size: { width: pt(540), height: pt(80) },
        transform: { scaleX: 1, scaleY: 1, translateX: 30, translateY: 130, unit: 'PT' },
      },
    }},
    { insertText: { objectId: titleId, text: label } },
    { updateTextStyle: {
      objectId: titleId,
      style: textStyle({ bold: true, fontSize: 30, color: rgb(255, 255, 255) }),
      fields: 'bold,fontSize,foregroundColor,fontFamily',
    }},
  ];
}

/**
 * One artwork card slide.
 * Layout: image on left (if image_url available), title + link on right.
 */
function makeArtworkSlide(slideId, item, index) {
  const bgId = `${slideId}_bg`;
  const titleId = `${slideId}_title`;
  const linkId = `${slideId}_link`;
  const collId = `${slideId}_coll`;
  const numId = `${slideId}_num`;

  const requests = [
    { createSlide: { objectId: slideId, slideLayoutReference: { predefinedLayout: 'BLANK' } } },
    { updatePageProperties: {
      objectId: slideId,
      pageProperties: { pageBackgroundFill: solidFill(250, 250, 252) },
      fields: 'pageBackgroundFill',
    }},
    // Index number (top left)
    { createShape: {
      objectId: numId,
      shapeType: 'TEXT_BOX',
      elementProperties: {
        pageObjectId: slideId,
        size: { width: pt(40), height: pt(30) },
        transform: { scaleX: 1, scaleY: 1, translateX: 15, translateY: 10, unit: 'PT' },
      },
    }},
    { insertText: { objectId: numId, text: String(index + 1) } },
    { updateTextStyle: {
      objectId: numId,
      style: textStyle({ fontSize: 11, color: rgb(160, 160, 180) }),
      fields: 'bold,fontSize,foregroundColor,fontFamily',
    }},
    // Title
    { createShape: {
      objectId: titleId,
      shapeType: 'TEXT_BOX',
      elementProperties: {
        pageObjectId: slideId,
        size: { width: pt(360), height: pt(60) },
        transform: { scaleX: 1, scaleY: 1, translateX: 180, translateY: 60, unit: 'PT' },
      },
    }},
    { insertText: { objectId: titleId, text: item.title || 'Untitled' } },
    { updateTextStyle: {
      objectId: titleId,
      style: textStyle({ bold: true, fontSize: 15, color: rgb(20, 20, 40) }),
      fields: 'bold,fontSize,foregroundColor,fontFamily',
    }},
    // Collection
    { createShape: {
      objectId: collId,
      shapeType: 'TEXT_BOX',
      elementProperties: {
        pageObjectId: slideId,
        size: { width: pt(360), height: pt(30) },
        transform: { scaleX: 1, scaleY: 1, translateX: 180, translateY: 130, unit: 'PT' },
      },
    }},
    { insertText: { objectId: collId, text: item.source_collection || '' } },
    { updateTextStyle: {
      objectId: collId,
      style: textStyle({ fontSize: 11, color: rgb(120, 120, 150) }),
      fields: 'bold,fontSize,foregroundColor,fontFamily',
    }},
    // Link
    { createShape: {
      objectId: linkId,
      shapeType: 'TEXT_BOX',
      elementProperties: {
        pageObjectId: slideId,
        size: { width: pt(360), height: pt(30) },
        transform: { scaleX: 1, scaleY: 1, translateX: 180, translateY: 160, unit: 'PT' },
      },
    }},
    { insertText: { objectId: linkId, text: item.product_url || '' } },
    { updateTextStyle: {
      objectId: linkId,
      style: textStyle({ fontSize: 10, color: rgb(60, 100, 200) }),
      fields: 'bold,fontSize,foregroundColor,fontFamily',
    }},
  ];

  // Add image if we have a URL
  if (item.image_url) {
    const imgId = `${slideId}_img`;
    requests.push({
      createImage: {
        objectId: imgId,
        url: item.image_url,
        elementProperties: {
          pageObjectId: slideId,
          size: { width: pt(155), height: pt(155) },
          transform: { scaleX: 1, scaleY: 1, translateX: 15, translateY: 55, unit: 'PT' },
        },
      },
    });
  }

  return requests;
}

/** Gallery wall set slide */
function makeGallerySetSlide(slideId, setObj) {
  const titleId = `${slideId}_title`;
  const bodyId = `${slideId}_body`;
  const items = setObj.items || [];

  const bodyText = items
    .map((it, i) => `${i + 1}. ${it.title}\n   ${it.product_url}`)
    .join('\n\n');

  return [
    { createSlide: { objectId: slideId, slideLayoutReference: { predefinedLayout: 'BLANK' } } },
    { updatePageProperties: {
      objectId: slideId,
      pageProperties: { pageBackgroundFill: solidFill(248, 248, 252) },
      fields: 'pageBackgroundFill',
    }},
    { createShape: {
      objectId: titleId,
      shapeType: 'TEXT_BOX',
      elementProperties: {
        pageObjectId: slideId,
        size: { width: pt(540), height: pt(40) },
        transform: { scaleX: 1, scaleY: 1, translateX: 30, translateY: 15, unit: 'PT' },
      },
    }},
    { insertText: { objectId: titleId, text: `Gallery Wall Set ${setObj.setNumber}${setObj.theme ? ': ' + setObj.theme : ''}` } },
    { updateTextStyle: {
      objectId: titleId,
      style: textStyle({ bold: true, fontSize: 18, color: rgb(30, 30, 50) }),
      fields: 'bold,fontSize,foregroundColor,fontFamily',
    }},
    { createShape: {
      objectId: bodyId,
      shapeType: 'TEXT_BOX',
      elementProperties: {
        pageObjectId: slideId,
        size: { width: pt(540), height: pt(310) },
        transform: { scaleX: 1, scaleY: 1, translateX: 30, translateY: 65, unit: 'PT' },
      },
    }},
    { insertText: { objectId: bodyId, text: bodyText || 'No items.' } },
    { updateTextStyle: {
      objectId: bodyId,
      style: textStyle({ fontSize: 10, color: rgb(50, 50, 70) }),
      fields: 'bold,fontSize,foregroundColor,fontFamily',
    }},
  ];
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function createSlidesDeck(brief, { primary = [], accent = [], galleryWallSets = [] }) {
  const auth = await getAuth();
  const slides = google.slides({ version: 'v1', auth });
  const drive = google.drive({ version: 'v3', auth });

  // Create a blank presentation
  const presentation = await slides.presentations.create({
    requestBody: { title: `${brief.projectName || 'S6 Trade Curation'} — Society6 Recommendations` },
  });
  const presentationId = presentation.data.presentationId;

  // Delete the default blank slide
  const defaultSlideId = presentation.data.slides[0].objectId;

  const requests = [];

  // Remove default slide first
  requests.push({ deleteObject: { objectId: defaultSlideId } });

  // Cover
  requests.push(...makeCoverSlide(presentationId, brief));

  // Brief summary
  requests.push(...makeBriefSlide(presentationId, brief));

  // Primary Collection header + slides
  requests.push(...makeSectionHeaderSlide('sec_primary', 'Primary Collection'));
  primary.forEach((item, i) => {
    requests.push(...makeArtworkSlide(`primary_${i}`, item, i));
  });

  // Accent & Alternates header + slides
  if (accent.length > 0) {
    requests.push(...makeSectionHeaderSlide('sec_accent', 'Accent & Alternates'));
    accent.forEach((item, i) => {
      requests.push(...makeArtworkSlide(`accent_${i}`, item, i));
    });
  }

  // Gallery Wall sets
  if (galleryWallSets.length > 0) {
    requests.push(...makeSectionHeaderSlide('sec_gallery', 'Gallery Wall Sets'));
    galleryWallSets.forEach((setObj, i) => {
      requests.push(...makeGallerySetSlide(`gw_${i}`, setObj));
    });
  }

  // Execute all requests in batches (API has a limit per call)
  const BATCH_SIZE = 50;
  for (let i = 0; i < requests.length; i += BATCH_SIZE) {
    const batch = requests.slice(i, i + BATCH_SIZE);
    await slides.presentations.batchUpdate({
      presentationId,
      requestBody: { requests: batch },
    });
  }

  // Share with the trade team user directly.
  // Note: 'type: anyone' is blocked by the Google Workspace org policy on this project,
  // so we share with the specific user email instead.
  await drive.permissions.create({
    fileId: presentationId,
    requestBody: { role: 'writer', type: 'user', emailAddress: 'jalderman@gmail.com' },
  });

  const deckUrl = `https://docs.google.com/presentation/d/${presentationId}/edit`;
  return { presentationId, deckUrl };
}

// ─── HTTP Route Handler ───────────────────────────────────────────────────────

export async function POST(request) {
  try {
    const body = await request.json();
    const { brief, primary, accent, galleryWallSets } = body;

    if (!brief) {
      return Response.json({ error: 'Missing brief in request body' }, { status: 400 });
    }

    const result = await createSlidesDeck(brief, {
      primary: primary || [],
      accent: accent || [],
      galleryWallSets: galleryWallSets || [],
    });

    return Response.json(result);
  } catch (error) {
    console.error('Slides generation error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}
