// app/api/updates/send-monday/route.js
import { getInitiatives } from '../../../lib/googleSheets';
import { DIGEST_RECIPIENTS, TEST_MODE, getTestEmail, normalizeOwner } from '../../../lib/owners';
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

export async function POST(request) {
  const authHeader = request.headers.get('x-admin-secret');
  if (authHeader !== process.env.ADMIN_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const initiatives = await getInitiatives();

    const byPillar = {};
    for (const initiative of initiatives) {
      if (!initiative.initiative) continue;
      const pillar = initiative.pillar || 'Other';
      if (!byPillar[pillar]) byPillar[pillar] = [];
      byPillar[pillar].push({
        initiative: initiative.initiative,
        owner: initiative.owner,
        status: initiative.status,
        targetDate: initiative.targetDate,
        latestNote: getMostRecentEntry(initiative.notes),
      });
    }

    const digestText = buildDigestText(byPillar);
    const summary = await generateSummary(digestText);
    const recipients = TEST_MODE ? [getTestEmail()] : DIGEST_RECIPIENTS;
    const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

    for (const recipient of recipients) {
      await sendEmail({
        to: recipient,
        subject: `Society6 Initiative Update — ${dateStr}`,
        body: summary,
      });
    }

    return Response.json({ success: true, recipients, testMode: TEST_MODE });
  } catch (err) {
    console.error('send-monday error:', err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}

function getMostRecentEntry(notes) {
  if (!notes) return null;
  const entries = notes.split(/(?=\d{1,2}\/\d{1,2}(?:\/\d{2,4})?:)/g).filter(e => e.trim());
  if (!entries.length) return null;
  return entries[entries.length - 1].trim();
}

function buildDigestText(byPillar) {
  let text = '';
  for (const [pillar, items] of Object.entries(byPillar)) {
    text += `\n## ${pillar}\n`;
    for (const item of items) {
      text += `\n**${item.initiative}** (${item.owner}${item.targetDate ? `, due ${item.targetDate}` : ''}, status: ${item.status || 'yellow'})\n`;
      text += item.latestNote ? `${item.latestNote}\n` : `No recent update.\n`;
    }
  }
  return text;
}

async function generateSummary(digestText) {
  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1000,
    messages: [{
      role: 'user',
      content: `You are writing a Monday morning initiative update email for Julie Matrat (CEO) and Sara Jackson (COO) of Society6.

Below is the raw initiative data with latest notes. Write a clean, scannable email digest that:
- Opens with a single sentence framing
- Groups updates by pillar using ALL CAPS section names
- For each initiative: one line with name, owner, and latest update
- Flags items with no recent update as "⚠️ No update"
- Flags any Red status items
- Closes with 1-2 sentences on the biggest things to watch this week
- Tone: direct, warm, treats Julie and Sara as smart operators who just want the facts

Raw data:
${digestText}

Write only the email body. Plain text only.`,
    }],
  });

  return message.content[0].text;
}

async function sendEmail({ to, subject, body }) {
  const nodemailer = await import('nodemailer');
  const transporter = nodemailer.default.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });

  await transporter.sendMail({
    from: `"Society6 Updates" <${process.env.GMAIL_USER}>`,
    to,
    subject,
    text: body,
  });
}
