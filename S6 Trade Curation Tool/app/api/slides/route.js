import { NextResponse } from 'next/server';
import { createSlidesDeck } from '../../../lib/slides';

export async function POST(request) {
  try {
    const body = await request.json();
    const { brief, primary, accent, galleryWallSets } = body;

    if (!brief) {
      return NextResponse.json({ error: 'Missing brief data.' }, { status: 400 });
    }

    if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
      return NextResponse.json(
        {
          error: 'Google Slides not configured yet.',
          setupRequired: true,
          instructions: [
            '1. Create a Google Cloud project at console.cloud.google.com',
            '2. Enable the Google Slides API and Google Drive API',
            '3. Create a Service Account under IAM & Admin',
            '4. Download the JSON key file',
            '5. Run: cat service-account-key.json | base64 | pbcopy',
            '6. Add GOOGLE_SERVICE_ACCOUNT_KEY=<pasted value> to your .env.local file',
            '7. Restart the app',
          ],
        },
        { status: 501 }
      );
    }

    const result = await createSlidesDeck(brief, { primary, accent, galleryWallSets });

    return NextResponse.json({
      success: true,
      url: result.url,
      presentationId: result.presentationId,
    });
  } catch (err) {
    console.error('[/api/slides]', err);

    if (err.message?.includes('GOOGLE_SERVICE_ACCOUNT_KEY')) {
      return NextResponse.json(
        { error: err.message, setupRequired: true },
        { status: 501 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to create Google Slides deck.', detail: err.message },
      { status: 500 }
    );
  }
}
