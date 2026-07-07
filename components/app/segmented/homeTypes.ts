import type { useQuery } from 'convex/react';
import type { api } from '@/convex/_generated/api';

/** Shape of getHomeSummary's non-null result, shared by the home tabs. */
export type HomeSummary = NonNullable<
  ReturnType<typeof useQuery<typeof api.features.home.getHomeSummary>>
>;
export type Level = HomeSummary['levels'][number];
export type CustomCollectionSummary = HomeSummary['customCollections'][number];
