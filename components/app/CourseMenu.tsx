"use client";

import { useQuery, useMutation } from "convex/react";
import { useTranslations } from "next-intl";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Check, Plus, X } from "lucide-react";
import { getLanguagesByCodes } from "@/lib/languages";
import { cn } from "@/lib/utils";

interface CourseMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CourseMenu({ open, onOpenChange }: CourseMenuProps) {
  const t = useTranslations("AppPage");
  const courses = useQuery(api.courses.getUserCourses);
  const activeCourse = useQuery(api.courses.getActiveCourse);
  const setActiveCourse = useMutation(api.courses.setActiveCourse);

  const handleSelectCourse = async (courseId: Id<"courses">) => {
    try {
      await setActiveCourse({ courseId });
      onOpenChange(false);
    } catch (error) {
      console.error("Error setting active course:", error);
    }
  };

  const formatCourseName = (targetLanguages: string[]) => {
    const targetLanguageObjects = getLanguagesByCodes(targetLanguages);
    const targetNames = targetLanguageObjects.map((l) => l.name).join(", ");
    return targetNames;
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-full sm:max-w-md flex flex-col p-0">
        <SheetTitle className="sr-only">{t("courses.title")}</SheetTitle>
        <SheetDescription className="sr-only">
          {t("courses.description")}
        </SheetDescription>
        {/* Header */}
        <div className="sticky top-0 z-10 border-b bg-background px-4 h-14 flex items-center justify-between">
          <h2 className="font-semibold text-lg">{t("courses.title")}</h2>
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
        <div className="flex-1 overflow-y-auto px-4 py-6">
          {/* Create New Course Button */}
          <Button
            variant="outline"
            className="w-full mb-4 gap-2"
            onClick={() => {
              // Functionality to be implemented
              console.log("Create new course");
            }}
          >
            <Plus className="h-4 w-4" />
            {t("courses.createNew")}
          </Button>

          {/* Courses List */}
          <div className="flex flex-col gap-3">
            {courses === undefined ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="h-24 rounded-lg bg-muted animate-pulse"
                  />
                ))}
              </div>
            ) : courses.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <p className="text-sm text-muted-foreground">
                  {t("courses.noCourses")}
                </p>
              </div>
            ) : (
              courses.map((course) => {
                const isActive = activeCourse?._id === course._id;
                const targetLanguageName = formatCourseName(course.targetLanguages);

                return (
                  <Card
                    key={course._id}
                    className={cn(
                      "cursor-pointer transition-all hover:shadow-md",
                      isActive && "ring-2 ring-primary border-primary"
                    )}
                    onClick={() => handleSelectCourse(course._id)}
                  >
                    <CardContent className="p-4 flex items-center justify-between">
                      <div className="flex flex-col gap-1">
                        <h3 className="font-semibold text-base">
                          {targetLanguageName}
                        </h3>
                        {/* <p className="text-sm text-muted-foreground">
                          {t("courses.learning", { language: targetLanguageName })}
                        </p> */}
                      </div>
                      {isActive && (
                        <div className="flex items-center gap-2 text-primary">
                          <span className="text-sm font-medium">{t("courses.active")}</span>
                          <Check className="h-5 w-5" />
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

