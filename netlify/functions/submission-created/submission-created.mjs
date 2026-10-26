// Runs on every verified Netlify Forms submission on this site (Netlify's
// "submission-created" event) and forwards the person to the shared lead-capture
// endpoint on the Institute site, so every form lands in ActiveCampaign with a source
// tag (JT's rule). Events forms: tagged by region and the events picked. Speaking and
// contact: tag only (never a mailing list), plus the contact topic. Every form also gets
// where the visitor came from (jt-from-newsletter, jt-from-instagram...). The ActiveCampaign key stays in one place (the Institute's env).
// Netlify Forms still stores every submission and emails JT as before.
const LEAD_CAPTURE_URL = process.env.LEAD_CAPTURE_URL || 'https://performanceneurology.institute/api/lead-capture';
const SOURCES = { 'event-updates': 'events-near-me', 'event-host': 'event-host', 'speaking-inquiry': 'jt-speaking', contact: 'jt-contact' };
const slug = (v) => String(v || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').slice(0, 40);

export const handler = async (event) => {
  let payload;
  try { payload = JSON.parse(event.body).payload; } catch { return { statusCode: 200 }; }
  const source = SOURCES[payload?.form_name];
  if (!source) return { statusCode: 200 };
  const d = payload.data || {};
  const extraTags = [];
  if (slug(d.region)) extraTags.push(`events-region-${slug(d.region)}`);
  for (const key of ['evening', 'workshop', 'musicians', 'house-concert']) if (d[`interest-${key}`]) extraTags.push(`events-interest-${key}`);
  if (source === 'jt-speaking' || source === 'jt-contact') {
    extraTags.length = 0;
    if (source === 'jt-contact' && slug(d.topic)) extraTags.push(`jt-topic-${slug(d.topic)}`);
  }
  if (slug(d['came-from'])) extraTags.push(`jt-from-${slug(d['came-from'])}`);
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
