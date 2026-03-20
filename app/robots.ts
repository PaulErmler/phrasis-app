import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  const siteUrl = process.env.SITE_URL ?? 'https://flexling.app';

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/app/', '/api/', '/auth/'],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
