import { NextResponse } from 'next/server';
import { createSlidesDeck } from '../../../lib/slides';

export async function POST(request) {
  if (!process.env.GOOGLE_CLIENT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
    return NextResponse.json(
      {
        error: 'Google Slides not configured',
        setup: 'Add GOOGLE_CLIENT_EMAIL and GOOGLE_PRIVATE_KEY environment variables in Netlify.',
      },
      { status: 501 }
    );
  }

  try {
    const body = await request.json();
    const { brief, primary, accent, galleryWallSets } = body;

    if (!brief || !primary) {
      return NextResponse.json({ error: 'Missing brief or recommendations' }, { status: 400 });
    }

    const result = await createSlidesDeck(brief, {
      primary: primary || [],
      accent: accent || [],
      galleryWallSets: galleryWallSets || [],
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error('Slides error:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to create deck' },
      { status: 500 }
    );
  }
}
