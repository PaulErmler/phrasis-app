"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Check, Plus, Loader2, CheckCircle2 } from "lucide-react";
import { getCollectionDescription } from "./CollectionCarouselUI";
import { useTranslations } from "next-intl";

export interface PreviewText {
  _id: string;
  text: string;
  collectionRank?: number;
}

interface CollectionDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  collectionName: string | null;
  totalTexts: number;
  cardsAdded: number;
  isActive: boolean;
  isComplete: boolean;
  texts: PreviewText[];
  isLoadingTexts: boolean;
  isAdding: boolean;
  onSelect: () => void;
  onAddCards: () => void;
}

export function CollectionDetailDialog({
  open,
  onOpenChange,
  collectionName,
  totalTexts,
  cardsAdded,
  isActive,
  isComplete,
  texts,
  isLoadingTexts,
  isAdding,
  onSelect,
  onAddCards,
}: CollectionDetailDialogProps) {
  const t = useTranslations("AppPage.collections.carousel.detail");
  const tDesc = useTranslations("AppPage.collections.carousel.descriptions");

  if (!collectionName) return null;

  const progress =
    totalTexts > 0 ? (cardsAdded / totalTexts) * 100 : 0;
  const description = getCollectionDescription(collectionName, (key) => tDesc(key));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="heading-dialog">
            {collectionName}
          </DialogTitle>
          <DialogDescription className="text-sm leading-relaxed">
            {description}
          </DialogDescription>
          <p className="text-muted-sm">
            {t("totalCards", { count: totalTexts.toLocaleString() })}
          </p>
        </DialogHeader>

        <div className="space-y-4">
          <Separator />

          {/* Progress + Select row */}
          <div className="flex items-center gap-3">
            <div className="flex-1 content-box space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-muted-sm">{t("progress")}</span>
                <span className="text-sm font-bold">
                  {cardsAdded} / {totalTexts}
                </span>
              </div>
              <Progress value={progress} className="h-2" />
            </div>

            {!isComplete ? (
              <Button
                variant={isActive ? "default" : "outline"}
                className="shrink-0 gap-1.5"
                onClick={onSelect}
              >
                {isActive && <Check className="h-4 w-4" />}
                {t("select")}
              </Button>
            ) : (
              <div className="flex items-center gap-1.5 text-sm text-success font-medium shrink-0 px-3">
                <CheckCircle2 className="h-5 w-5" />
                {t("done")}
              </div>
            )}
          </div>

          <Separator />

          {/* Next sentences section */}
          {isComplete ? (
            <div className="text-center py-6 space-y-2">
              <CheckCircle2 className="h-10 w-10 text-success mx-auto" />
              <p className="text-sm font-medium">
                {t("allCardsAdded")}
              </p>
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="flex items-center justify-between">
                <h4 className="text-base font-semibold">{t("nextSentences")}</h4>
                {texts.length > 0 && (
                  <Button
                    size="sm"
                    disabled={isAdding}
                    onClick={onAddCards}
                    className="gap-1.5"
                  >
                    {isAdding ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {t("adding")}
                      </>
                    ) : (
                      <>
                        <Plus className="h-4 w-4" />
                        {t("addN", { count: texts.length })}
                      </>
                    )}
                  </Button>
                )}
              </div>

              <Separator />

              {/* Sentence list */}
              {isLoadingTexts ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-14 w-full rounded-xl" />
                  ))}
                </div>
              ) : texts.length === 0 ? (
                <div className="text-center py-6 space-y-2">
                  <CheckCircle2 className="h-10 w-10 text-success mx-auto" />
                  <p className="text-sm font-medium">
                    {t("noMoreCards")}
                  </p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {texts.map((text) => (
                    <div
                      key={text._id}
                      className="content-box p-4 text-sm leading-relaxed"
                    >
                      {text.text}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
