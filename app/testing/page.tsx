"use client";

import { FlaskConical } from "lucide-react";
import { TranslationTest } from "@/components/testing/TranslationTest";
import { NotificationTest } from "@/components/testing/NotificationTest";
import { CollectionsPreview } from "@/components/app/CollectionsPreview";

export default function TestingPage() {
  return (
    <div className="max-w-5xl mx-auto p-4">
      {/* Page Header */}
      <div className="text-center py-4 mb-6">
        <div className="flex items-center justify-center gap-2 mb-2">
          <FlaskConical className="h-6 w-6" />
          <h1 className="text-2xl font-bold">Testing</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Test various app features and integrations
        </p>
      </div>

      {/* Responsive Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Translation Test Card */}
        <div className="md:col-span-2 lg:col-span-1">
          <TranslationTest />
        </div>

        {/* Notification Card */}
        <NotificationTest />

        {/* Collections Preview */}
        <div className="md:col-span-2 lg:col-span-1">
          <CollectionsPreview />
        </div>
      </div>
    </div>
  );
}
