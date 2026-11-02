// Lists the pages search engines should index. /start, /thanks and the thank-you pages are left out on purpose.
const pages = ['/', '/speaking', '/about', '/books', '/press', '/events', '/music', '/booking', '/contact'];

export function GET({ site }: { site: URL }) {
  const urls = pages.map((p) => `  <url><loc>${new URL(p, site).href}</loc></url>`).join('\n');
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
    { headers: { 'Content-Type': 'application/xml' } },
  );
}
