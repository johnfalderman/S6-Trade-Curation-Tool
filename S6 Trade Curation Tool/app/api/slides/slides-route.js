import { NextResponse } from 'next/server';
import { createSlidesDeck } from '../../../lib/slides';

export async function POST(request) {
  // Check for required Google credentials
  if (!process.env.GOOGLE_CLIENT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
    return NextResponse.json(
      {
        error: 'Google Slides not configured',
        setup: [
          'In Netlify → Site configuration → Environment variables, add:',
          '  GOOGLE_CLIENT_EMAIL  — the service account email address',
          '  GOOGLE_PRIVATE_KEY   — the PEM private key from your service account JSON',
          '',
          'To get GOOGLE_PRIVATE_KEY, run in Terminal:',
          '  cat ~/Downloads/s6-trade-curation-*.json | python3 -c "import sys,json; print(json.load(sys.stdin)[\'private_key\'])" | pbcopy',
          '',
          'Then paste the value into Netlify. It will look like:',
          '  -----BEGIN RSA PRIVATE KEY-----',
          '  MIIEoAIBAAKCAQEA...',
          '  -----END RSA PRIVATE KEY-----',
        ].join('\n'),
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
