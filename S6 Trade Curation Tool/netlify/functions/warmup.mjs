// Scheduled keep-warm ping.
// Runs on a cron schedule (see config below) and hits the recommendation route's
// lightweight GET warmup path so its serverless container stays hot. This is what
// prevents cold starts from exceeding Netlify's ~10s function limit and 504-ing.
export default async () => {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL || process.env.DEPLOY_URL || '';
  if (!base) return new Response('no site URL available', { status: 200 });
  try {
    const res = await fetch(`${base}/api/recommend`, { method: 'GET' });
    return new Response(`warmed: ${res.status}`, { status: 200 });
  } catch (e) {
    console.warn('warmup ping failed:', e.message);
    return new Response('warmup ping failed', { status: 200 });
  }
};

// Every 5 minutes — inside the container's warm-idle window.
export const config = { schedule: '*/5 * * * *' };
