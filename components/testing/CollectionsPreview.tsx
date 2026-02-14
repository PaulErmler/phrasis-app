'use client';

import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Skeleton } from '@/components/ui/skeleton';
import { BookOpen } from 'lucide-react';

export function CollectionsPreview() {
  const collections = useQuery(api.testing.texts.getCollectionsWithTexts, {
    textsPerCollection: 5,
  });

  if (collections === undefined) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            Collections
          </CardTitle>
          <CardDescription>Loading collections...</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-10 w-full" />
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  if (collections.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            Collections
          </CardTitle>
          <CardDescription>
            No collections available yet. Run the upload script to add texts.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <BookOpen className="h-5 w-5" />
          Collections
        </CardTitle>
        <CardDescription>
          Browse texts organized by difficulty level
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Accordion type="single" collapsible className="w-full">
          {collections.map((collection) => (
            <AccordionItem key={collection._id} value={collection._id}>
              <AccordionTrigger className="hover:no-underline">
                <div className="flex items-center gap-3">
                  <Badge variant="outline" className="font-mono">
                    {collection.name}
                  </Badge>
                  <span className="text-muted-sm">
                    {collection.textCount} texts
                  </span>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <ul className="space-y-2 pl-2">
                  {collection.texts.map((text, index) => (
                    <li
                      key={text._id}
                      className="flex items-start gap-2 text-sm"
                    >
                      <span className="text-muted-foreground font-mono min-w-[1.5rem]">
                        {index + 1}.
                      </span>
                      <span>{text.text}</span>
                    </li>
                  ))}
                  {collection.textCount > 5 && (
                    <li className="text-muted-sm pl-6">
                      ... and {collection.textCount - 5} more
                    </li>
                  )}
                </ul>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </CardContent>
    </Card>
  );
}
