"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AudioSpacedView } from "@/components/app/AudioSpacedView";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";

export default function AudioSpacedRepetitionPage() {
  const router = useRouter();
  const currentUser = useQuery(api.auth.getCurrentUser);

  useEffect(() => {
    if (currentUser === null) {
      router.push("/login");
    }
  }, [currentUser, router]);

  if (currentUser === undefined) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="p-8 max-w-md text-center">
          <Spinner />
        </Card>
      </div>
    );
  }

  if (!currentUser) {
    return null;
  }

  return <AudioSpacedView />;
}
