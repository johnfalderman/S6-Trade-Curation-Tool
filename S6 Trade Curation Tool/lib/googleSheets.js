// lib/googleSheets.js
import { GoogleAuth } from 'google-auth-library';

const SPREADSHEET_ID = '1PniKXrXb2RRtK0akhMzaDeUEpC4P9RS6LFfTUO8WfFk';
const SHEET_NAME = '90-day Customer Experience Action plan';

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
  if (!creds.client_email || !creds.private_key) {
    throw new Error('Credential JSON missing client_email or private_key');
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

export async function getInitiatives() {
  const token = await getAccessToken();
  const range = encodeURIComponent(`${SHEET_NAME}!A:I`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${range}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (!data.values) throw new Error(`No data returned: ${JSON.stringify(data)}`);

  const rows = data.values;
  const initiatives = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const pillar = row[0] || '';
    const initiative = row[1] || '';
    const owner = row[2] || '';
    const targetDate = row[5] || '';
    const status = row[6] || '';
    const notes = row[8] || '';

    if (!initiative || !owner || initiative === 'Initiative') continue;
    if (pillar === 'On Deck' || pillar === 'Parking Lot') continue;

    initiatives.push({
      rowIndex: i + 1,
      pillar,
      initiative,
      owner,
      targetDate,
      status,
      notes,
    });
  }

  return initiatives;
}

export function getMostRecentNoteDate(notes) {
  if (!notes) return null;
  const datePattern = /(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?:/g;
  const matches = [...notes.matchAll(datePattern)];
  if (!matches.length) return null;

  const currentYear = new Date().getFullYear();
  let mostRecent = null;

  for (const match of matches) {
    const month = parseInt(match[1]);
    const day = parseInt(match[2]);
    const date = new Date(currentYear, month - 1, day);
    if (!mostRecent || date > mostRecent) mostRecent = date;
  }

  return mostRecent;
}

export function needsUpdate(notes) {
  const lastDate = getMostRecentNoteDate(notes);
  if (!lastDate) return true;
  const daysSince = (Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24);
  return daysSince > 4;
}

export async function appendUpdate(rowIndex, currentNotes, newUpdate, date, newStatus) {
  const token = await getAccessToken();

  const dateStr = formatDate(date || new Date());
  const entry = `${dateStr}: ${newUpdate.trim()}`;

  const trimmedExisting = trimNotes(currentNotes);
  const updatedNotes = trimmedExisting
    ? `${trimmedExisting}\n${entry}`
    : entry;

  const requestBody = { data: [], valueInputOption: 'RAW' };

  requestBody.data.push({
    range: `${SHEET_NAME}!I${rowIndex}`,
    values: [[updatedNotes]],
  });

  if (newStatus) {
    requestBody.data.push({
      range: `${SHEET_NAME}!G${rowIndex}`,
      values: [[newStatus]],
    });
  }

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values:batchUpdate`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  return res.json();
}

function trimNotes(notes) {
  if (!notes) return '';
  const entries = notes.split(/(?=\d{1,2}\/\d{1,2}(?:\/\d{2,4})?:)/g).filter(e => e.trim());
  if (entries.length <= 2) return notes.trim();
  return entries.slice(-2).join('').trim();
}

function formatDate(date) {
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const yy = String(date.getFullYear()).slice(-2);
  return `${m}/${d}/${yy}`;
}