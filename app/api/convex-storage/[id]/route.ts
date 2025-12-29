import { NextRequest } from "next/server";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;
  const internal = process.env.CONVEX_INTERNAL_URL;
  if (!internal) {
    return new Response("CONVEX_INTERNAL_URL not set", { status: 500 });
  }

  const storageUrl = `${internal.replace(/\/$/, "")}/api/storage/${encodeURIComponent(
    id
  )}`;

  const res = await fetch(storageUrl);
  if (!res.ok) {
    return new Response(null, { status: res.status });
  }

  const contentType = res.headers.get("content-type") || "audio/mpeg";

  const headers: Record<string, string> = {
    "Content-Type": contentType,
  };

  const cacheControl = res.headers.get("cache-control");
  if (cacheControl) headers["Cache-Control"] = cacheControl;

  return new Response(res.body, { status: 200, headers });
}
