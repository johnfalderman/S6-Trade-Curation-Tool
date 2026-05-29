import { GoogleAuth } from 'google-auth-library';

export const dynamic = 'force-dynamic';

const SPREADSHEET_ID = '1PniKXrXb2RRtK0akhMzaDeUEpC4P9RS6LFfTUO8WfFk';

export async function GET() {
  try {
    const creds = JSON.parse(
      Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_B64, 'base64').toString('utf8')
    );
    const auth = new GoogleAuth({
      credentials: creds,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const client = await auth.getClient();
    const { token } = await client.getAccessToken();

    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}?fields=properties.title,sheets.properties.title`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await res.json();

    return Response.json({
      success: true,
      spreadsheetTitle: data?.properties?.title || null,
      tabs: (data.sheets || []).map((s) => s.properties.title),
      raw: data.error || null,
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}