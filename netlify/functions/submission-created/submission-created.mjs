// Runs on every verified Netlify Forms submission on this site (Netlify's
// "submission-created" event). For the two /events forms, it forwards the person
// to the shared lead-capture endpoint on the Institute site, so they land in
// ActiveCampaign tagged by form, region and the events they picked. The
// ActiveCampaign key stays in one place (the Institute site's env).
// Netlify Forms still stores every submission and emails JT as before.
const LEAD_CAPTURE_URL = process.env.LEAD_CAPTURE_URL || 'https://performanceneurology.institute/api/lead-capture';
const SOURCES = { 'event-updates': 'events-near-me', 'event-host': 'event-host' };
const slug = (v) => String(v || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').slice(0, 40);

export const handler = async (event) => {
  let payload;
  try { payload = JSON.parse(event.body).payload; } catch { return { statusCode: 200 }; }
  const source = SOURCES[payload?.form_name];
  if (!source) return { statusCode: 200 };
  const d = payload.data || {};
  const extraTags = [];
  if (slug(d.region)) extraTags.push(`events-region-${slug(d.region)}`);
  for (const key of ['evening', 'workshop', 'musicians']) if (d[`interest-${key}`]) extraTags.push(`events-interest-${key}`);
  const firstName = (d['first-name'] || String(d.name || '').split(' ')[0] || '').trim();
  try {
    const res = await fetch(LEAD_CAPTURE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: d.email, firstName, source, extraTags, city: d.city, region: d.region }),
    });
    if (!res.ok) console.error('lead-capture forward failed', res.status, await res.text().catch(() => ''));
  } catch (e) {
    console.error('lead-capture forward error', e);
  }
  return { statusCode: 200 };
};
