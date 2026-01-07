import { preloadQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { getToken } from "@/lib/auth-server";
import { AppPageClient } from "./AppPageClient";

export default async function AppPage() {
  const token = await getToken();
  const preloadedSettings = await preloadQuery(
    api.courses.getUserSettings,
    {},
    { token: token ?? undefined }
  );

  return <AppPageClient preloadedSettings={preloadedSettings} />;
}
