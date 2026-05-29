import { getInitiatives } from '@/lib/googleSheets';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const initiatives = await getInitiatives();
    return Response.json({
      success: true,
      count: initiatives.length,
      sample: initiatives.slice(0, 3),
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}