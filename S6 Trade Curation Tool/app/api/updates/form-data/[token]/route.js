// app/api/updates/form-data/[token]/route.js
import { validateToken } from '../../../../lib/updateTokens';
import { getInitiatives, needsUpdate } from '../../../../lib/googleSheets';
import { normalizeOwner } from '../../../../lib/owners';

export async function GET(request, { params }) {
  const { token } = params;

  try {
    const tokenData = await validateToken(token);
    if (!tokenData) {
      return Response.json({ error: 'Invalid or expired link' }, { status: 401 });
    }

    const allInitiatives = await getInitiatives();

    const ownerInitiatives = allInitiatives.filter(i => {
      const ownerKey = normalizeOwner(i.owner);
      return ownerKey === tokenData.ownerName && needsUpdate(i.notes);
    });

    return Response.json({
      ownerName: tokenData.ownerName,
      initiatives: ownerInitiatives.map(i => ({
        rowIndex: i.rowIndex,
        initiative: i.initiative,
        pillar: i.pillar,
        targetDate: i.targetDate,
        status: i.status,
        currentNotes: i.notes,
      })),
    });
  } catch (err) {
    console.error('form-data error:', err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
