import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';

/**
 * Internal mutation to seed mock stats data for a user.
 * Run from the Convex dashboard with a userId (auth subject string).
 * Looks up the user's active course and generates ~180 days of realistic data.
 */
export const seedMockStats = internalMutation({
  args: {
    userId: v.string(),
  },
  handler: async (ctx, { userId }) => {
    // Look up active course
    const settings = await ctx.db
      .query('userSettings')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .first();
    if (!settings?.activeCourseId) throw new Error('No active course for user');

    const course = await ctx.db.get(settings.activeCourseId);
    if (!course) throw new Error('Course not found');

    const courseId = course._id;
    const tz = 'Europe/Berlin';
    const now = new Date();
    const DAYS = 180;

    // Deterministic-ish seed from userId
    let seed = 0;
    for (let i = 0; i < userId.length; i++) seed += userId.charCodeAt(i);
    function rand() {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return (seed % 10000) / 10000;
    }

    // =========================================================================
    // Generate daily stats
    // =========================================================================
    const dailyDocs: Array<{
      date: string;
      reps: number;
      newCards: number;
      timeMs: number;
      cardsReviewed: number;
      hourBuckets: number[];
      chatMessagesSent: number;
      chatCardsApproved: number;
      cardsAddedManually: number;
      accuracySum: number;
      accuracyCount: number;
    }> = [];

    for (let i = DAYS - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const dow = d.getDay();
      const isWeekend = dow === 0 || dow === 6;

      // ~12% skip days
      if (rand() < 0.12) continue;

      const base = isWeekend ? 0.6 : 1;
      const reps = Math.floor((rand() * 60 + 20) * base);
      const newCards = Math.floor(rand() * 6 * base);
      const timeMs = Math.floor((rand() * 15 + 5) * 60000 * base);
      const cardsReviewed = reps;
      const accuracyCount = Math.floor(reps * 0.6);
      const accuracySum = Math.floor(accuracyCount * (rand() * 20 + 65));

      // Hour buckets: morning peak (7-9) + evening peak (19-22)
      const hourBuckets = Array.from({ length: 24 }, () => 0);
      for (let r = 0; r < reps; r++) {
        const p = rand();
        let hour: number;
        if (p < 0.3) hour = 7 + Math.floor(rand() * 3);       // morning 7-9
        else if (p < 0.8) hour = 19 + Math.floor(rand() * 4);  // evening 19-22
        else hour = Math.floor(rand() * 24);                     // scattered
        hourBuckets[hour]++;
      }

      // Sparse event counters
      const chatMessagesSent = rand() < 0.2 ? Math.floor(rand() * 4 + 1) : 0;
      const chatCardsApproved = rand() < 0.15 ? Math.floor(rand() * 3 + 1) : 0;
      const cardsAddedManually = rand() < 0.1 ? Math.floor(rand() * 2 + 1) : 0;

      dailyDocs.push({
        date: dateStr,
        reps,
        newCards,
        timeMs,
        cardsReviewed,
        hourBuckets,
        chatMessagesSent,
        chatCardsApproved,
        cardsAddedManually,
        accuracySum,
        accuracyCount,
      });
    }

    // =========================================================================
    // Generate daily language stats
    // =========================================================================
    const targetLanguages = course.targetLanguages ?? ['en'];
    const langDailyDocs: Array<{
      date: string;
      language: string;
      reps: number;
      newCards: number;
      timeMs: number;
      newWordsCount: number;
    }> = [];

    for (const day of dailyDocs) {
      // Split the day's stats across target languages
      let remainingReps = day.reps;
      let remainingNew = day.newCards;
      let remainingTime = day.timeMs;

      for (let li = 0; li < targetLanguages.length; li++) {
        const lang = targetLanguages[li];
        const isLast = li === targetLanguages.length - 1;
        // Primary language gets ~60%, rest split evenly
        const fraction = isLast
          ? 1
          : li === 0
            ? Math.min(0.6 + rand() * 0.1, 1)
            : (1 - 0.6) / Math.max(targetLanguages.length - 1, 1);

        const langReps = isLast ? remainingReps : Math.floor(day.reps * fraction);
        const langNew = isLast ? remainingNew : Math.floor(day.newCards * fraction);
        const langTime = isLast ? remainingTime : Math.floor(day.timeMs * fraction);
        const newWords = Math.floor(langNew * (rand() * 4 + 3));

        remainingReps -= langReps;
        remainingNew -= langNew;
        remainingTime -= langTime;

        if (langReps > 0 || langNew > 0) {
          langDailyDocs.push({
            date: day.date,
            language: lang,
            reps: langReps,
            newCards: langNew,
            timeMs: langTime,
            newWordsCount: newWords,
          });
        }
      }
    }

    // Insert daily language stats
    for (const ld of langDailyDocs) {
      await ctx.db.insert('dailyLanguageStats', {
        userId,
        courseId,
        date: ld.date,
        language: ld.language,
        reps: ld.reps,
        newCards: ld.newCards,
        timeMs: ld.timeMs,
        newWordsCount: ld.newWordsCount,
      });
    }

    // Aggregate into languageStats (all-time per language)
    const langTotals = new Map<string, { reps: number; newCards: number; timeMs: number; words: number }>();
    for (const ld of langDailyDocs) {
      const existing = langTotals.get(ld.language) ?? { reps: 0, newCards: 0, timeMs: 0, words: 0 };
      existing.reps += ld.reps;
      existing.newCards += ld.newCards;
      existing.timeMs += ld.timeMs;
      existing.words += ld.newWordsCount;
      langTotals.set(ld.language, existing);
    }

    for (const [language, data] of langTotals) {
      await ctx.db.insert('languageStats', {
        userId,
        courseId,
        language,
        totalRepetitions: data.reps,
        totalNewCards: data.newCards,
        totalTimeMs: data.timeMs,
        totalWords: data.words,
      });
    }

    // Insert daily stats
    for (const day of dailyDocs) {
      await ctx.db.insert('dailyStats', {
        userId,
        courseId,
        date: day.date,
        reps: day.reps,
        newCards: day.newCards,
        timeMs: day.timeMs,
        cardsReviewed: day.cardsReviewed,
        hourBuckets: day.hourBuckets,
        chatMessagesSent: day.chatMessagesSent,
        chatCardsApproved: day.chatCardsApproved,
        cardsAddedManually: day.cardsAddedManually,
        accuracySum: day.accuracySum,
        accuracyCount: day.accuracyCount,
      });
    }

    // =========================================================================
    // Aggregate into weekly stats
    // =========================================================================
    const weeklyMap = new Map<string, { reps: number; newCards: number; timeMs: number; activeDays: number }>();
    for (const day of dailyDocs) {
      const d = new Date(day.date + 'T00:00:00');
      const jan4 = new Date(d.getFullYear(), 0, 4);
      const dayOfYear = Math.floor((d.getTime() - jan4.getTime()) / 86400000) + 4;
      const weekNum = Math.ceil(dayOfYear / 7);
      const weekStr = `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;

      const existing = weeklyMap.get(weekStr) ?? { reps: 0, newCards: 0, timeMs: 0, activeDays: 0 };
      existing.reps += day.reps;
      existing.newCards += day.newCards;
      existing.timeMs += day.timeMs;
      existing.activeDays++;
      weeklyMap.set(weekStr, existing);
    }

    for (const [week, data] of weeklyMap) {
      await ctx.db.insert('weeklyStats', {
        userId,
        courseId,
        week,
        totalRepetitions: data.reps,
        totalNewCards: data.newCards,
        totalTimeMs: data.timeMs,
        activeDays: data.activeDays,
      });
    }

    // =========================================================================
    // Aggregate into monthly stats
    // =========================================================================
    const monthlyMap = new Map<string, { reps: number; newCards: number; timeMs: number; activeDays: number; weeks: Set<string> }>();
    for (const day of dailyDocs) {
      const monthStr = day.date.slice(0, 7);
      const d = new Date(day.date + 'T00:00:00');
      const jan4 = new Date(d.getFullYear(), 0, 4);
      const dayOfYear = Math.floor((d.getTime() - jan4.getTime()) / 86400000) + 4;
      const weekNum = Math.ceil(dayOfYear / 7);
      const weekStr = `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;

      const existing = monthlyMap.get(monthStr) ?? { reps: 0, newCards: 0, timeMs: 0, activeDays: 0, weeks: new Set() };
      existing.reps += day.reps;
      existing.newCards += day.newCards;
      existing.timeMs += day.timeMs;
      existing.activeDays++;
      existing.weeks.add(weekStr);
      monthlyMap.set(monthStr, existing);
    }

    for (const [month, data] of monthlyMap) {
      await ctx.db.insert('monthlyStats', {
        userId,
        courseId,
        month,
        totalRepetitions: data.reps,
        totalNewCards: data.newCards,
        totalTimeMs: data.timeMs,
        activeDays: data.activeDays,
        activeWeeks: data.weeks.size,
      });
    }

    // =========================================================================
    // Aggregate into yearly stats
    // =========================================================================
    const yearlyMap = new Map<string, { reps: number; newCards: number; timeMs: number; activeDays: number; weeks: Set<string>; months: Set<string> }>();
    for (const day of dailyDocs) {
      const yearStr = day.date.slice(0, 4);
      const monthStr = day.date.slice(0, 7);
      const d = new Date(day.date + 'T00:00:00');
      const jan4 = new Date(d.getFullYear(), 0, 4);
      const dayOfYear = Math.floor((d.getTime() - jan4.getTime()) / 86400000) + 4;
      const weekNum = Math.ceil(dayOfYear / 7);
      const weekStr = `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;

      const existing = yearlyMap.get(yearStr) ?? { reps: 0, newCards: 0, timeMs: 0, activeDays: 0, weeks: new Set(), months: new Set() };
      existing.reps += day.reps;
      existing.newCards += day.newCards;
      existing.timeMs += day.timeMs;
      existing.activeDays++;
      existing.weeks.add(weekStr);
      existing.months.add(monthStr);
      yearlyMap.set(yearStr, existing);
    }

    for (const [year, data] of yearlyMap) {
      await ctx.db.insert('yearlyStats', {
        userId,
        courseId,
        year,
        totalRepetitions: data.reps,
        totalNewCards: data.newCards,
        totalTimeMs: data.timeMs,
        activeDays: data.activeDays,
        activeWeeks: data.weeks.size,
        activeMonths: data.months.size,
      });
    }

    // =========================================================================
    // Upsert courseStats
    // =========================================================================
    const totals = dailyDocs.reduce(
      (acc, d) => ({
        reps: acc.reps + d.reps,
        newCards: acc.newCards + d.newCards,
        timeMs: acc.timeMs + d.timeMs,
        chatMessages: acc.chatMessages + d.chatMessagesSent,
        chatCards: acc.chatCards + d.chatCardsApproved,
        manualCards: acc.manualCards + d.cardsAddedManually,
        accuracySum: acc.accuracySum + d.accuracySum,
        accuracyCount: acc.accuracyCount + d.accuracyCount,
      }),
      { reps: 0, newCards: 0, timeMs: 0, chatMessages: 0, chatCards: 0, manualCards: 0, accuracySum: 0, accuracyCount: 0 },
    );

    // Compute streak from most recent consecutive active days
    const sortedDates = dailyDocs.map((d) => d.date).sort().reverse();
    let streak = 0;
    const todayStr = now.toISOString().slice(0, 10);
    let expectedDate = todayStr;
    for (const date of sortedDates) {
      if (date === expectedDate) {
        streak++;
        const prev = new Date(expectedDate + 'T00:00:00');
        prev.setDate(prev.getDate() - 1);
        expectedDate = prev.toISOString().slice(0, 10);
      } else if (date < expectedDate) {
        break;
      }
    }

    const existing = await ctx.db
      .query('courseStats')
      .withIndex('by_userId_and_courseId', (q) => q.eq('userId', userId).eq('courseId', courseId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        totalRepetitions: (existing.totalRepetitions ?? 0) + totals.reps,
        totalTimeMs: (existing.totalTimeMs ?? 0) + totals.timeMs,
        totalCards: (existing.totalCards ?? 0) + totals.newCards,
        currentStreak: streak,
        lastActivityDate: sortedDates[0],
        totalWordCount: (existing.totalWordCount ?? 0) + Math.floor(totals.newCards * 8),
        totalChatMessages: (existing.totalChatMessages ?? 0) + totals.chatMessages,
        totalChatCardsApproved: (existing.totalChatCardsApproved ?? 0) + totals.chatCards,
        totalCardsAddedManually: (existing.totalCardsAddedManually ?? 0) + totals.manualCards,
        totalAccuracySum: (existing.totalAccuracySum ?? 0) + totals.accuracySum,
        totalAccuracyCount: (existing.totalAccuracyCount ?? 0) + totals.accuracyCount,
      });
    } else {
      await ctx.db.insert('courseStats', {
        userId,
        courseId,
        totalRepetitions: totals.reps,
        totalTimeMs: totals.timeMs,
        totalCards: totals.newCards,
        currentStreak: streak,
        lastActivityDate: sortedDates[0],
        timezone: tz,
        totalWordCount: Math.floor(totals.newCards * 8),
        totalChatMessages: totals.chatMessages,
        totalChatCardsApproved: totals.chatCards,
        totalCardsAddedManually: totals.manualCards,
        totalAccuracySum: totals.accuracySum,
        totalAccuracyCount: totals.accuracyCount,
      });
    }

    return {
      daysInserted: dailyDocs.length,
      weeksInserted: weeklyMap.size,
      monthsInserted: monthlyMap.size,
      yearsInserted: yearlyMap.size,
      totalReps: totals.reps,
      streak,
    };
  },
});
