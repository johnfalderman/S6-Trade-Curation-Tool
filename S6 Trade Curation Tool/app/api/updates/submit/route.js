// app/api/updates/submit/route.js
import { validateToken, markTokenUsed } from '../../../lib/updateTokens';
import { appendUpdate } from '../../../lib/googleSheets';

const MAX_CHARS = 300;
const VALID_STATUSES = ['Green', 'Yellow', 'Red'];

export async function POST(request) {
  try {
    const body = await request.json();
    const { token, updates } = body;

    if (!token || !updates || !Array.isArray(updates)) {
      return Response.json({ error: 'Missing token or updates' }, { status: 400 });
    }

    const tokenData = await validateToken(token);
    if (!tokenData) {
      return Response.json({ error: 'Invalid or expired token' }, { status: 401 });
    }

    const today = new Date();
    const results = [];

    for (const item of updates) {
      const { rowIndex, initiative, currentNotes, currentStatus, update, newStatus } = item;

      const hasUpdate = update && update.trim();
      const statusChanged = newStatus && VALID_STATUSES.includes(newStatus) && newStatus !== currentStatus;
      if (!hasUpdate && !statusChanged) continue;

      const trimmed = hasUpdate ? update.trim().slice(0, MAX_CHARS) : null;
      const statusToWrite = statusChanged ? newStatus : null;
      const noteToWrite = trimmed || `Status changed to ${statusToWrite}.`;

      await appendUpdate(rowIndex, currentNotes, noteToWrite, today, statusToWrite);
      results.push({ initiative, status: 'updated', noteWritten: !!trimmed, statusChanged });
    }

    await markTokenUsed(token);

    return Response.json({ success: true, updated: results.length, results });
  } catch (err) {
    console.error('submit error:', err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
