"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { useTranslations, useLocale } from "next-intl";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Check, Plus, X } from "lucide-react";
import { getLocalizedLanguageNameByCode } from "@/lib/languages";
import { cn } from "@/lib/utils";
import { CreateCourseDialog } from "@/components/course/CreateCourseDialog";

interface CourseMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CourseMenu({ open, onOpenChange }: CourseMenuProps) {
  const t = useTranslations("AppPage");
  const locale = useLocale();
  const courses = useQuery(api.features.courses.getUserCourses);
  const activeCourse = useQuery(api.features.courses.getActiveCourse);
  const setActiveCourse = useMutation(api.features.courses.setActiveCourse);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  const handleSelectCourse = async (courseId: Id<"courses">) => {
    try {
        onOpenChange(false);
        await setActiveCourse({ courseId });
      
    } catch (error) {
      console.error("Error setting active course:", error);
    }
  };

  const formatCourseName = (targetLanguages: string[]) => {
    const targetNames = targetLanguages
      .map((code) => getLocalizedLanguageNameByCode(code, locale))
      .join(", ");
    return targetNames;
  };

  const formatBaseLanguageName = (baseLanguages: string[]) => {
    const baseNames = baseLanguages
      .map((code) => getLocalizedLanguageNameByCode(code, locale))
      .join(", ");
    return baseNames;
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-full sm:max-w-md flex flex-col p-0">
        <SheetTitle className="sr-only">{t("courses.title")}</SheetTitle>
        <SheetDescription className="sr-only">
          {t("courses.description")}
        </SheetDescription>
        {/* Header */}
        <div className="sheet-header">
          <h2 className="heading-section">{t("courses.title")}</h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onOpenChange(false)}
            className="-mr-2"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Content */}
        <div className="sheet-body">
          {/* Create New Course Button */}
          <Button
            variant="outline"
            className="w-full mb-3 gap-2 h-9"
            onClick={() => setCreateDialogOpen(true)}
          >
            <Plus className="h-4 w-4" />
            {t("courses.createNew")}
          </Button>

          {/* Courses List */}
          <div className="flex flex-col gap-2">
            {courses === undefined ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="h-14 rounded-xl bg-muted animate-pulse"
                  />
                ))}
              </div>
            ) : courses.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <p className="text-muted-sm">
                  {t("courses.noCourses")}
                </p>
              </div>
            ) : (
              courses.map((course) => {
                const isActive = activeCourse?._id === course._id;
                const targetLanguageName = formatCourseName(course.targetLanguages);
                const baseLanguageName = formatBaseLanguageName(course.baseLanguages);

                return (
                  <Button
                    key={course._id}
                    variant="ghost"
                    onClick={() => handleSelectCourse(course._id)}
                    className={cn(
                      "w-full h-auto flex items-center justify-between gap-3 p-3 rounded-xl border transition-all text-left whitespace-normal",
                      isActive
                        ? "border-primary bg-primary/5 shadow-sm hover:bg-primary/5"
                        : "border-muted hover:border-muted-foreground/30 hover:bg-muted/50"
                    )}
                  >
                    <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                      <h3 className="font-semibold text-base leading-tight">
                        {targetLanguageName}
                      </h3>
                      <p className="text-muted-xs">
                        {t("courses.from", { language: baseLanguageName })}
                      </p>
                    </div>
                    {isActive && (
                      <div className="flex items-center gap-1.5 text-primary shrink-0">
                        <span className="text-xs font-medium">{t("courses.active")}</span>
                        <Check className="h-4 w-4" />
                      </div>
                    )}
                  </Button>
                );
              })
            )}
          </div>
        </div>
      </SheetContent>
      
      <CreateCourseDialog 
        open={createDialogOpen} 
        onOpenChange={setCreateDialogOpen}
      />
    </Sheet>
  );
}

