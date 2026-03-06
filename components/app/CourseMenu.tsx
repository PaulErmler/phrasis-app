'use client';

import { useState } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { useTranslations, useLocale } from 'next-intl';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Check, Plus, Settings2, X } from 'lucide-react';
import { getLocalizedLanguageNameByCode } from '@/lib/languages';
import { cn } from '@/lib/utils';
import { CreateCourseDialog } from '@/components/course/CreateCourseDialog';
import { CourseLanguageSettings } from '@/components/course/CourseLanguageSettings';

interface CourseMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CourseMenu({ open, onOpenChange }: CourseMenuProps) {
  const t = useTranslations('AppPage');
  const locale = useLocale();
  const courses = useQuery(api.features.courses.getUserCourses);
  const activeCourse = useQuery(api.features.courses.getActiveCourse);
  const setActiveCourse = useMutation(api.features.courses.setActiveCourse);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editingCourseId, setEditingCourseId] = useState<Id<'courses'> | null>(
    null,
  );

  const editingCourse = courses?.find((c) => c._id === editingCourseId) ?? null;

  const handleSelectCourse = async (courseId: Id<'courses'>) => {
    try {
      await setActiveCourse({ courseId });
    } catch (error) {
      console.error('Error setting active course:', error);
    }
  };

  const handleOpenSettings = (courseId: Id<'courses'>) => {
    setEditingCourseId(courseId);
  };

  const handleCloseSettings = () => {
    setEditingCourseId(null);
  };

  const formatCourseName = (targetLanguages: string[]) => {
    return targetLanguages
      .map((code) => getLocalizedLanguageNameByCode(code, locale))
      .join(', ');
  };

  const formatBaseLanguageName = (baseLanguages: string[]) => {
    return baseLanguages
      .map((code) => getLocalizedLanguageNameByCode(code, locale))
      .join(', ');
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="left"
          className="w-full sm:max-w-md flex flex-col p-0"
        >
          <SheetTitle className="sr-only">{t('courses.title')}</SheetTitle>
          <SheetDescription className="sr-only">
            {t('courses.description')}
          </SheetDescription>

          <div className="sheet-header">
            <h2 className="heading-section">{t('courses.title')}</h2>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onOpenChange(false)}
              className="-mr-2"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>

          <div className="sheet-body">
            <Button
              variant="outline"
              className="w-full mb-3 gap-2 h-9"
              onClick={() => setCreateDialogOpen(true)}
            >
              <Plus className="h-4 w-4" />
              {t('courses.createNew')}
            </Button>

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
                  <p className="text-muted-sm">{t('courses.noCourses')}</p>
                </div>
              ) : (
                courses.map((course) => {
                  const isActive = activeCourse?._id === course._id;
                  const targetLanguageName = formatCourseName(
                    course.targetLanguages,
                  );
                  const baseLanguageName = formatBaseLanguageName(
                    course.baseLanguages,
                  );

                  return (
                    <div
                      key={course._id}
                      className={cn(
                        'w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left',
                        isActive
                          ? 'border-primary bg-primary/5 shadow-sm'
                          : 'border-muted hover:border-muted-foreground/30',
                      )}
                    >
                      <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                        <h3 className="font-semibold text-base leading-tight">
                          {targetLanguageName}
                        </h3>
                        <p className="text-muted-xs">
                          {t('courses.from', {
                            language: baseLanguageName,
                          })}
                        </p>
                      </div>

                      <Button
                        variant={isActive ? 'secondary' : 'outline'}
                        size="sm"
                        className="shrink-0 w-28 justify-center"
                        onClick={() => handleSelectCourse(course._id)}
                      >
                        {isActive && <Check className="h-4 w-4" />}
                        {isActive
                          ? t('courses.selected')
                          : t('courses.select')}
                      </Button>

                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0"
                        onClick={() => handleOpenSettings(course._id)}
                      >
                        <Settings2 className="h-4 w-4" />
                      </Button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <CreateCourseDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
      />

      <CourseLanguageSettings
        course={editingCourse}
        onClose={handleCloseSettings}
      />
    </>
  );
}
