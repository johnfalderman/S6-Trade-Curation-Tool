import { NextResponse } from 'next/server';
import { parseBrief } from '../../../lib/parser';
import { getTaggedCatalog } from '../../../lib/catalog';
import { recommend } from '../../../lib/recommender';

export async function POST(request) {
  try {
    const body = await request.json();
    const { briefText, moodboardUrl } = body;

    if (!briefText || briefText.trim().length < 10) {
      return NextResponse.json(
        { error: 'Please paste your Jotform submission text (at least a few lines).' },
        { status: 400 }
      );
    }

    // Parse the brief
    const brief = parseBrief(briefText.trim());
    if (moodboardUrl) brief.moodboardUrl = moodboardUrl;

    // Load catalog
    const catalog = getTaggedCatalog();
    if (catalog.length === 0) {
      return NextResponse.json(
        { error: 'No catalog data loaded. Upload a catalog CSV first.' },
        { status: 503 }
      );
    }

    // Run recommendations
    const results = recommend(catalog, brief);

    return NextResponse.json({
      success: true,
      ...results,
      catalogSize: catalog.length,
    });
  } catch (err) {
    console.error('[/api/recommend]', err);
    return NextResponse.json(
      { error: 'Something went wrong generating recommendations.', detail: err.message },
      { status: 500 }
    );
  }
}
