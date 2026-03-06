# Quota Impact: Course Archiving & Language Changes

This document describes how the new course management features (archiving and multi-language support) should interact with the user quota system. Pass this to the quota implementation agent.

---

## Course Archiving

### Behavior

- **Archive**: A user can archive any active course. The course moves to the bottom of the course list, displayed greyed out with a strikethrough name.
- **Unarchive**: A user can restore an archived course, but only if quota is available.

### Quota Rules

| Action       | Quota Effect                                                                 |
| ------------ | ---------------------------------------------------------------------------- |
| Archive      | Frees 1 course slot (course no longer counts toward the user's course limit) |
| Unarchive    | Consumes 1 course slot (blocked if user is at their course limit)            |
| Create course | Consumes 1 course slot (blocked if user is at their course limit)           |

### Key Constraints

- Archived courses retain all their data (cards, progress, stats). Nothing is deleted.
- The user's active course cannot be archived. They must switch to another course first, or the system should auto-switch.
- When counting courses for quota, only non-archived courses count: `quota_used = courses.filter(c => !c.isArchived).length`

### Recommended Schema Changes

Add to the `courses` table in `convex/schema.ts`:

```typescript
courses: defineTable({
  userId: v.string(),
  baseLanguages: v.array(v.string()),
  targetLanguages: v.array(v.string()),
  currentLevel: v.optional(currentLevelValidator),
  isArchived: v.optional(v.boolean()), // NEW: defaults to false/undefined
}).index('by_userId', ['userId']),
```

### Recommended Backend Changes

1. **`getUserCourses`** (`convex/features/courses.ts`): Sort results so archived courses appear last.

2. **`createCourse`** (`convex/features/courses.ts`): Before inserting, check:
   ```
   non_archived_count = courses.filter(c => !c.isArchived).length
   if (non_archived_count >= user_quota.maxCourses) throw "Course limit reached"
   ```

3. **New mutation: `archiveCourse`**:
   - Args: `{ courseId: Id<'courses'> }`
   - Verify the user owns this course
   - If the course is the active course, switch to the first non-archived course (or clear `activeCourseId`)
   - Patch `isArchived: true`

4. **New mutation: `unarchiveCourse`**:
   - Args: `{ courseId: Id<'courses'> }`
   - Verify quota is available (non-archived count < maxCourses)
   - Patch `isArchived: false`

5. **`setActiveCourse`**: Add a guard to prevent setting an archived course as active.

---

## Multi-Language Support

### Behavior

- Courses already store `baseLanguages: string[]` and `targetLanguages: string[]`, but currently only contain 1 element each.
- Users can now add up to **3 target languages** and **3 base languages** per course.
- Languages can be reordered within their group and swapped between groups (base becomes target and vice versa).
- The first language in each group is treated as the "primary" language.

### Quota Rules

| Action                          | Quota Effect |
| ------------------------------- | ------------ |
| Add extra target language       | **None** — does not affect course quota |
| Add extra base language         | **None** — does not affect course quota |
| Remove a language               | **None**     |
| Swap language between groups    | **None**     |
| Reorder languages               | **None**     |

Adding extra languages is a feature of the course itself, not a separate quota dimension. If you later want to gate the number of additional languages behind a plan tier, that would be a separate limit (e.g., `maxLanguagesPerCourse`).

### Recommended Backend Changes

1. **New mutation: `updateCourseLanguages`**:
   - Args: `{ courseId: Id<'courses'>, targetLanguages: string[], baseLanguages: string[] }`
   - Validate: each array has 1-3 elements, no duplicates, no overlap between target and base
   - Validate: all language codes are in `SUPPORTED_LANGUAGES`
   - Patch the course document

2. **Update `courseSettings`**: The `baseLanguageOrder` and `targetLanguageOrder` fields already exist and will automatically apply to the new languages. When a language is added, it gets appended to the end of the order. When removed, it's stripped from the order arrays.

3. **Update `completeOnboarding`**: Accept multiple target/base languages from the onboarding flow. The schema already supports arrays, so this is a matter of passing through the full arrays instead of wrapping single values in `[code]`.

---

## Summary for Quota Agent

When implementing the quota system:

1. Add `isArchived: v.optional(v.boolean())` to the courses schema
2. Count only `!isArchived` courses toward the user's course limit
3. Block `createCourse` and `unarchiveCourse` when at limit
4. `archiveCourse` always succeeds and frees a slot
5. Language changes within a course have zero quota impact
6. The `activeCourseId` must always point to a non-archived course
