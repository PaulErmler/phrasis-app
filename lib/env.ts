function required(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  NEXT_PUBLIC_CONVEX_URL: required(
    process.env.NEXT_PUBLIC_CONVEX_URL,
    'NEXT_PUBLIC_CONVEX_URL',
  ),
  NEXT_PUBLIC_CONVEX_SITE_URL: required(
    process.env.NEXT_PUBLIC_CONVEX_SITE_URL,
    'NEXT_PUBLIC_CONVEX_SITE_URL',
  ),
} as const;
