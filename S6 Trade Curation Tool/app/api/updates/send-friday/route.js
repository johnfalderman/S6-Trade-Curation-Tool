// app/api/updates/send-friday/route.js
import { getInitiatives, needsUpdate } from '@/lib/googleSheets';
import { getOrCreateToken } from '@/lib/updateTokens';
import { OWNERS, TEST_MODE, getTestEmail, normalizeOwner } from '@/lib/owners';
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

export async function POST(request) {
  const authHeader = request.headers.get('x-admin-secret');
  if (authHeader !== process.env.ADMIN_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const initiatives = await getInitiatives();

    const ownerInitiatives = {};
    for (const initiative of initiatives) {
      const ownerKey = normalizeOwner(initiative.owner);
      if (!ownerKey) continue;
      if (!needsUpdate(initiative.notes)) continue;
      if (!ownerInitiatives[ownerKey]) ownerInitiatives[ownerKey] = [];
      ownerInitiatives[ownerKey].push(initiative);
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://s6-trade-curation.netlify.app';
    const results = [];

    for (const [ownerKey, staleItems] of Object.entries(ownerInitiatives)) {
      const owner = OWNERS[ownerKey];
      if (!owner) continue;

      const token = await getOrCreateToken(owner.name, owner.email);
      const formUrl = `${appUrl}/updates/${token}`;
      const emailBody = await generateEmail(owner, staleItems, formUrl);
      const toEmail = TEST_MODE ? getTestEmail() : owner.email;

      await sendEmail({
        to: toEmail,
        subject: `Quick Friday check-in: your Society6 initiatives`,
        body: emailBody,
      });

      results.push({ owner: owner.name, email: toEmail, itemCount: staleItems.length, token });
    }

    return Response.json({ success: true, sent: results, testMode: TEST_MODE });
  } catch (err) {
    console.error('send-friday error:', err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}

async function generateEmail(owner, initiatives, formUrl) {
  const itemList = initiatives.map(i => `- ${i.initiative} (${i.pillar})`).join('\n');

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 400,
    messages: [{
      role: 'user',
      content: `Write a short, warm, and direct Friday check-in email from John Alderman to ${owner.fullName} at Society6.

The email should:
- Be casual and friendly, not corporate
- Ask them to click the link and add brief updates (max 300 chars each) for their initiatives
- Mention it takes about 2 minutes
- Say Julie and Sara will see a summary Monday morning
- NOT list the initiatives in the email body (the form will show them)
- End with the form link naturally woven in

Their initiatives needing updates:
${itemList}

Form URL: ${formUrl}

Write only the email body — no subject line. Plain text, short paragraphs.`,
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
