"use client";

import { useTranslations } from "next-intl";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { CircleCheck, EyeOff, X } from "lucide-react";
import { DEFAULT_BATCH_SIZE, type CourseSettings } from "@/components/app/learning/types";

interface LearningModeSettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courseSettings: CourseSettings | null;
}

export function LearningModeSettings({
  open,
  onOpenChange,
  courseSettings,
}: LearningModeSettingsProps) {
  const t = useTranslations("LearningMode.settingsPanel");
  const updateSettings = useMutation(api.features.courses.updateCourseSettings);

  if (!courseSettings) return null;

  const handleBatchSizeChange = async (value: string) => {
    const num = parseInt(value, 10);
    if (isNaN(num) || num < 1 || num > 50) return;
    await updateSettings({
      courseId: courseSettings.courseId,
      cardsToAddBatchSize: num,
    });
  };

  const handleAutoAddChange = async (checked: boolean) => {
    await updateSettings({
      courseId: courseSettings.courseId,
      autoAddCards: checked,
    });
  };

  const handleInitialReviewsChange = async (value: string) => {
    const num = parseInt(value, 10);
    if (isNaN(num) || num < 1 || num > 20) return;
    await updateSettings({
      courseId: courseSettings.courseId,
      initialReviewCount: num,
    });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-[380px] p-0 [&>button:last-child]:hidden">
        <SheetDescription className="sr-only">{t("title")}</SheetDescription>

        {/* Header matching LearningMode header style */}
        <div className="border-b">
          <div className="px-4 h-14 flex items-center relative">
            <SheetTitle className="font-semibold text-lg absolute inset-0 flex items-center justify-center pointer-events-none">
              {t("title")}
            </SheetTitle>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onOpenChange(false)}
              className="ml-auto z-10 -mr-2"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>

        <div className="px-6 py-4 space-y-4">
          {/* Icon Legend */}
          <div className="rounded-md border bg-muted/40 px-3 py-2.5 space-y-1.5">
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              {t("iconLegend")}
            </p>
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2 text-xs">
                <CircleCheck className="h-3.5 w-3.5 text-green-600 shrink-0" />
                <span>{t("iconMaster")}</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <EyeOff className="h-3.5 w-3.5 text-orange-600 shrink-0" />
                <span>{t("iconHide")}</span>
              </div>
            </div>
          </div>

          {/* Cards per batch */}
          <div className="space-y-2">
            <Label htmlFor="batchSize" className="text-sm font-medium">
              {t("cardsPerBatch")}
            </Label>
            <p className="text-xs text-muted-foreground">
              {t("cardsPerBatchDescription")}
            </p>
            <Input
              id="batchSize"
              type="number"
              min={1}
              max={50}
              defaultValue={courseSettings.cardsToAddBatchSize ?? DEFAULT_BATCH_SIZE}
              onBlur={(e) => handleBatchSizeChange(e.target.value)}
              className="w-20 h-9"
            />
          </div>

          {/* Initial reviews */}
          <div className="space-y-2">
            <Label htmlFor="initialReviews" className="text-sm font-medium">
              {t("initialReviews")}
            </Label>
            <p className="text-xs text-muted-foreground">
              {t("initialReviewsDescription")}
            </p>
            <Input
              id="initialReviews"
              type="number"
              min={1}
              max={20}
              defaultValue={courseSettings.initialReviewCount}
              onBlur={(e) => handleInitialReviewsChange(e.target.value)}
              className="w-20 h-9"
            />
          </div>

          {/* Auto-add cards */}
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-0.5">
              <Label htmlFor="autoAdd" className="text-sm font-medium">
                {t("autoAddCards")}
              </Label>
              <p className="text-xs text-muted-foreground">
                {t("autoAddCardsDescription")}
              </p>
            </div>
            <Switch
              id="autoAdd"
              checked={courseSettings.autoAddCards ?? false}
              onCheckedChange={handleAutoAddChange}
              className="mt-0.5"
            />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
