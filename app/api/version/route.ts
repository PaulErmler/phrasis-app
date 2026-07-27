/**
 * Build identity of the currently deployed frontend, for AppUpdateGate.
 *
 * `force-static` prerenders this at build time into the deployment and serves it
 * from the CDN — zero function invocations. It is also what makes the signal
 * correct by construction: the response only exists once *this* deployment is
 * serving, so it can never announce a build that is not live yet (which a
 * backend-published version could, since `convex deploy --cmd 'pnpm run build'`
 * pushes Convex before Vercel goes live).
 *
 * The edge cache is deployment-scoped, so a new deployment invalidates it; only
 * the browser cache needs handling, which the client does with `cache: 'no-store'`.
 */
export const dynamic = 'force-static';

export function GET() {
  const buildId = process.env.NEXT_PUBLIC_BUILD_ID ?? 'dev';

  // Dev-only: lets you simulate "a newer build is deployed" without two real
  // deployments, since in dev both sides otherwise resolve to 'dev'.
  //   DEV_BUILD_ID=next-build pnpm dev
  // `NODE_ENV` is statically replaced at build time, so this branch is stripped
  // from production output and cannot be used to spoof a real deployment.
  if (process.env.NODE_ENV !== 'production' && process.env.DEV_BUILD_ID) {
    return Response.json({ buildId: process.env.DEV_BUILD_ID });
  }

  return Response.json({ buildId });
}
