import { NextResponse } from 'next/server';
import { getStore } from '@netlify/blobs';
import { randomBytes } from 'crypto';

const SHARE_STORE = 'shares';

// Short, URL-safe share ID. ~8 chars of base64url gives ~2.8 * 10^14 possibilities —
// plenty for an internal-facing tool. The randomness + the blob-existence
// check in the page means a collision is effectively impossible.
function shortId() {
  return randomBytes(6).toString('base64url');
}

// Trim the result payload down to only what the share page renders.
// Keeps the blob small, strips anything sensitive (like internal scores
// and the raw Claude reason strings — though we do keep reasons since
// they add value on the share page).
function sanitizeItem(item) {
  if (!item) return null;
  return {
    title: item.title || '',
    product_url: item.product_url || '',
    image_url: item.image_url || '',
    image_alt: item.image_alt || '',
    source_collection: item.source_collection || '',
    style: Array.isArray(item.style) ? item.style : [],
    palette: Array.isArray(item.palette) ? item.palette : [],
    reason: item.reason || '',
  };
}

// GET /api/share?id=xxx — retrieve a shared curation by ID.
// Used by the /share/[id] client page to load data via API rather than
// accessing Netlify Blobs directly from a server component (which can
// fail on Netlify's edge/serverless runtime).
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id || !/^[A-Za-z0-9_-]{4,32}$/.test(id)) {
      return NextResponse.json({ error: 'Invalid share ID' }, { status: 400 });
    }
    const store = getStore(SHARE_STORE);
    const raw = await store.get(id, { type: 'text' });
    if (!raw) {
      return NextResponse.json({ error: 'Share not found' }, { status: 404 });
    }
    return NextResponse.json(JSON.parse(raw));
  } catch (err) {
    console.error('Share GET error:', err);
    return NextResponse.json({ error: err.message || 'Failed to load share' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { brief, primary, accent, galleryWallSets } = body || {};

    const payload = {
      brief: {
        projectName: brief?.projectName || '',
        clientName: brief?.clientName || '',
        location: brief?.location || '',
        briefSummary: brief?.briefSummary || '',
        styleTags: brief?.styleTags || [],
        paletteTags: brief?.paletteTags || [],
        keyThemes: brief?.keyThemes || [],
      },
      primary: (primary || []).map(sanitizeItem).filter(Boolean),
      accent: (accent || []).map(sanitizeItem).filter(Boolean),
      galleryWallSets: (galleryWallSets || []).map(set => ({
        setNumber: set.setNumber,
        theme: set.theme || '',
        items: (set.items || []).map(sanitizeItem).filter(Boolean),
      })),
      createdAt: new Date().toISOString(),
    };

    const totalItems =
      payload.primary.length +
      payload.accent.length +
      payload.galleryWallSets.reduce((n, s) => n + s.items.length, 0);

    if (totalItems === 0) {
      return NextResponse.json(
        { error: 'Nothing to share. Select at least one item first.' },
        { status: 400 }
      );
    }

    const store = getStore(SHARE_STORE);

    // Retry on the very unlikely collision (10 tries max, then give up).
    let id = '';
    for (let i = 0; i < 10; i++) {
      const candidate = shortId();
      const existing = await store.get(candidate).catch(() => null);
      if (!existing) { id = candidate; break; }
    }
    if (!id) {
      return NextResponse.json({ error: 'Failed to generate share ID' }, { status: 500 });
    }

    await store.set(id, JSON.stringify(payload));

    return NextResponse.json({ id, itemCount: totalItems });
  } catch (err) {
    console.error('Share POST error:', err);
    return NextResponse.json({ error: err.message || 'Failed to create share' }, { status: 500 });
  }
}
