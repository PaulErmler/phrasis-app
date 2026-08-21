/**
 * Build identity of the currently deployed frontend, for AppUpdateGate.
 *
 * `force-static` prerenders this at build time into the deployment and serves it
 * from the CDN. Zero function invocations. It is also what makes the signal
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
  // Where next.config.ts got that id. AppUpdateGate ignores this field; it is
  // here so `curl /api/version` diagnoses itself. A 'fallback' source means no
  // host variable matched and update detection is dead, which is otherwise only
  // visible in the build log.
  const source = process.env.NEXT_PUBLIC_BUILD_ID_SOURCE ?? 'fallback';

  // Lets you simulate "a newer build is deployed" without two real deployments,
  // which is otherwise impossible in dev (both sides resolve to 'dev') and slow
  // on staging (a real redeploy per attempt).
  //   DEV_BUILD_ID=next-build pnpm dev
  // Gated on an explicit opt-in rather than NODE_ENV so a staging build can use
  // it. That costs nothing: DEV_BUILD_ID is a server-side variable, so anyone
  // able to set it already controls the deployment and has no need to spoof it.
  if (process.env.NEXT_PUBLIC_UPDATE_DEBUG === '1' && process.env.DEV_BUILD_ID) {
    return Response.json({ buildId: process.env.DEV_BUILD_ID, source: 'debug' });
  }

  return Response.json({ buildId, source });
}
