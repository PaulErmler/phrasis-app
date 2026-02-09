"use client";

import { RedirectToSignIn } from "@daveyplate/better-auth-ui";
import { Authenticated } from "convex/react";
import { LearningMode } from "@/components/app/LearningMode";

export default function LearnPage() {
  return (
    <>
      <RedirectToSignIn />
      <Authenticated>
        <LearningMode />
      </Authenticated>
    </>
  );
}

