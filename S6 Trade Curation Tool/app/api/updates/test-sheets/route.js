export async function GET() {
  try {
    const email = process.env.GOOGLE_CLIENT_EMAIL;
    const privateKey = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

    if (!email || !privateKey) return Response.json({ error: 'Missing credentials', email: !!email, key: !!privateKey });

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

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt,
      }),
    });

    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      return Response.json({ error: 'Token failed', detail: tokenData });
    }

    const sheetRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/1PniKXrXb2RRtK0akhMzaDeUEpC4P9RS6LFfTUO8WfFk/values/${encodeURIComponent('90-day Customer Experience Action plan!A1:C5')}`,
      { headers: { Authorization: `Bearer ${tokenData.access_token}` } }
    );

    const sheetData = await sheetRes.json();
    return Response.json({ success: true, email, sheetData });
  } catch (err) {
    return Response.json({ error: err.message });
  }
}
