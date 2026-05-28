// lib/googleSheets.js
const SPREADSHEET_ID = '1PniKXrXb2RRtK0akhMzaDeUEpC4P9RS6LFfTUO8WfFk';
const SHEET_NAME = '90-day Action Plan';

async function getAccessToken() {
  let raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  // Handle base64-encoded JSON
  if (!raw.trim().startsWith('{')) {
    raw = Buffer.from(raw, 'base64').toString('utf8');
  }
  const json = JSON.parse(raw);
  const email = json.client_email;
  const privateKey = json.private_key;

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };

  const header = { alg: 'RS256', typ: 'JWT' };
  const encode = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const signingInput = `${encode(header)}.${encode(payload)}`;

  const crypto = await import('crypto');
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(signingInput);
  const signature = sign.sign(privateKey, 'base64url');
  const jwt = `${signingInput}.${signature}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  const data = await res.json();
  if (!data.access_token) throw new Error(`Token error: ${JSON.stringify(data)}`);
  return data.access_token;
}

export async function getInitiatives() {
  const token = await getAccessToken();
  const range = encodeURIComponent(`${SHEET_NAME}!A:I`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${range}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (!data.values) throw new Error('No data returned from sheet');

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
