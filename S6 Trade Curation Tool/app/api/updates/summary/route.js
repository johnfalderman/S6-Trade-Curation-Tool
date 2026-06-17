// app/api/updates/summary/route.js
import { getStore } from '@netlify/blobs';
import { GoogleAuth } from 'google-auth-library';

const SPREADSHEET_ID = '1PniKXrXb2RRtK0akhMzaDeUEpC4P9RS6LFfTUO8WfFk';
const SHEET_NAME = "'90-day Customer Experience Action plan '";
const SNAPSHOT_STORE = 'planning-snapshots';

const STATUS_ORDER = [
  'High Risk',
  'Low Risk',
  'On Track',
  'Not Started',
  'A New Proposal',
];

let _auth = null;
function getAuth() {
  if (_auth) return _auth;
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_B64;
  if (!b64) throw new Error('GOOGLE_SERVICE_ACCOUNT_B64 is not set');

  let creds;
  try {
    creds = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  } catch (e) {
    throw new Error('Failed to decode GOOGLE_SERVICE_ACCOUNT_B64: ' + e.message);
  }

  _auth = new GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return _auth;
}

async function getAccessToken() {
  const client = await getAuth().getClient();
  const { token } = await client.getAccessToken();
  if (!token) throw new Error('getAccessToken returned an empty token');
  return token;
}

async function readRows() {
  const token = await getAccessToken();
  const range = encodeURIComponent(`${SHEET_NAME}!A:I`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${range}`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  if (!data.values) throw new Error(`No data returned: ${JSON.stringify(data)}`);
  return data.values;
}

function parsePeopleCell(raw) {
  if (!raw) return [];
  let cell = String(raw).trim();
  if (!cell) return [];

  const parenMatch = cell.match(/\(([^)]*)\)/);
  if (parenMatch) {
    cell = parenMatch[1];
  }

  const parts = cell
    .split(/,|\band\b/gi)
    .map(p => p.trim())
    .filter(Boolean);

  return parts;
}

function displayLabel(name) {
  return name
    .split(/\s+/)
    .map(w => (w.length ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

function buildSummary(rows) {
  const statusCounts = {};
  for (const s of STATUS_ORDER) statusCounts[s] = 0;
  statusCounts['Other'] = 0;

  const peopleCounts = {};
  let initiativeCount = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const pillar = row[0] || '';
    const initiative = row[1] || '';
    const people = row[4] || '';
    const status = (row[6] || '').trim();

    if (!initiative || initiative === 'Initiative') continue;
    if (pillar === 'On Deck' || pillar === 'Parking Lot') continue;

    initiativeCount++;

    if (!status) {
      statusCounts['Other']++;
    } else {
      const match = STATUS_ORDER.find(s => s.toLowerCase() === status.toLowerCase());
      if (match) statusCounts[match]++;
      else statusCounts['Other']++;
    }

    const names = parsePeopleCell(people);
    for (const n of names) {
      const key = n.toLowerCase();
      if (!peopleCounts[key]) peopleCounts[key] = { label: displayLabel(n), count: 0 };
      peopleCounts[key].count++;
    }
  }

  const statusData = STATUS_ORDER.map(s => ({ label: s, count: statusCounts[s] }));
  if (statusCounts['Other'] > 0) {
    statusData.push({ label: 'No status set', count: statusCounts['Other'] });
  }

  const peopleData = Object.values(peopleCounts)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  return { initiativeCount, statusData, peopleData };
}

function isoWeekKey(d = new Date()) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

export async function GET() {
  try {
    const rows = await readRows();
    const summary = buildSummary(rows);

    const store = getStore(SNAPSHOT_STORE);
    const thisKey = isoWeekKey();

    let index = [];
    try {
      const idxRaw = await store.get('index', { type: 'json' });
      if (Array.isArray(idxRaw)) index = idxRaw;
    } catch {
      index = [];
    }

    const snapshot = {
      week: thisKey,
      takenAt: new Date().toISOString(),
      statusData: summary.statusData,
    };
    await store.setJSON(`week:${thisKey}`, snapshot);

    if (!index.includes(thisKey)) {
      index.push(thisKey);
      index.sort();
      await store.setJSON('index', index);
    }

    let lastWeek = null;
    const priorKeys = index.filter(k => k < thisKey);
    if (priorKeys.length) {
      const prevKey = priorKeys[priorKeys.length - 1];
      try {
        const prev = await store.get(`week:${prevKey}`, { type: 'json' });
        if (prev) lastWeek = prev;
      } catch {
        lastWeek = null;
      }
    }

    return Response.json({
      success: true,
      thisWeek: { week: thisKey, statusData: summary.statusData },
      lastWeek: lastWeek ? { week: lastWeek.week, statusData: lastWeek.statusData } : null,
      people: summary.peopleData,
      initiativeCount: summary.initiativeCount,
    });
  } catch (err) {
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }
}
