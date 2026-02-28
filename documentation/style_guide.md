# Phrasis App Style Guide

This document defines the canonical styling tokens and patterns used across the Phrasis app. All views and components must follow these standards to ensure visual consistency.

**Stack**: Tailwind CSS v4, shadcn/ui (New York style), Geist + Geist Mono fonts, oklch color tokens.

---

## Reusable CSS Classes

These classes are defined in `app/globals.css` (`@layer components`). Prefer them over inline Tailwind when they match the pattern.

| Class | Equivalent | Usage |
| --- | --- | --- |
| `sticky-header` | `sticky top-0 z-10 border-b bg-background` | App header, sheet header bar |
| `header-bar` | `container mx-auto px-4 h-14 flex items-center justify-between` | Inner bar inside sticky header |
| `app-view` | `max-w-xl mx-auto space-y-6` | Top-level wrapper for page views |
| `sheet-header` | `sticky top-0 z-10 border-b bg-background px-4 h-14 flex items-center justify-between` | Sheet/panel header |
| `sheet-body` | `flex-1 overflow-y-auto px-4 py-6` | Scrollable sheet content |
| `sheet-footer` | `sticky bottom-0 border-t bg-background px-4 py-4` | Pinned sheet footer |
| `heading-section` | `text-lg font-semibold` | Page/section/card titles |
| `heading-dialog` | `text-xl font-bold` | Dialog/sheet modal titles |
| `body-large` | `text-lg leading-relaxed` | Learning card content |
| `stat-value` | `text-lg font-semibold` | Stat numbers (e.g. streak, reps) |
| `label-form` | `text-sm font-medium text-muted-foreground` | Form labels |
| `text-muted-sm` | `text-sm text-muted-foreground` | Secondary text |
| `text-muted-xs` | `text-xs text-muted-foreground` | Small labels, helper text |
| `text-success` | `text-green-600` | Success states, completed items |
| `text-warning` | `text-orange-600` | Warning states, hidden items |
| `card-surface` | `rounded-xl border bg-card shadow-sm` | Cards (when not using `Card` component) |
| `content-box` | `rounded-xl border p-3` | Bordered containers |
| `surface-muted` | `rounded-lg bg-muted/50` | Muted background blocks |
| `state-active` | `border-primary bg-primary/5 shadow-sm` | Active/selected state |

---

## Typography

| Token | Classes | Usage |
| --- | --- | --- |
| Page title | `font-semibold text-lg` | Header bar titles (in sticky headers) |
| Section heading | `text-lg font-semibold` | Section titles within a page view |
| Card title | `text-lg font-semibold` | Titles rendered on cards |
| Dialog/sheet title | `text-xl font-bold` | Titles inside Dialog or Sheet modals |
| Body | `text-sm` | Default body text |
| Body large | `text-lg leading-relaxed` | Learning card content, primary sentence text |
| Muted text | `text-sm text-muted-foreground` | Secondary descriptions, subtitles |
| Small label | `text-xs text-muted-foreground` | Stats, captions, badge text |
| Label | `text-sm font-medium text-muted-foreground` | Form-style labels above inputs |
| Helper | `text-xs text-muted-foreground` | Helper text below inputs |

### Rules

- Never use `text-2xl` for card or dialog titles. Use `text-xl font-bold` for dialogs and `text-lg font-semibold` for cards.
- Prefer `font-semibold` over `font-bold` for in-page headings. Reserve `font-bold` for dialog/sheet titles only.
- Always add `leading-relaxed` when using `text-lg` for readable content.

---

## Cards and Surfaces

| Token | Classes | Usage |
| --- | --- | --- |
| Standard card | Use the `Card` component (renders `rounded-xl border bg-card shadow-sm`) | Primary content containers |
| Inline card | `rounded-xl border bg-card shadow-sm` | When the `Card` component is too heavy or wrapping doesn't fit |
| Content box | `rounded-xl border p-3` | Non-elevated bordered containers (e.g. progress boxes) |
| Muted surface | `rounded-lg bg-muted/50` | Subtle background areas (e.g. email display, info blocks) |
| Active state | `border-primary bg-primary/5 shadow-sm` | Active/selected items (e.g. active course) |

### Rules

- Always use `rounded-xl` for cards and bordered containers. Never use `rounded-lg` or `rounded-2xl` for cards.
- Use `rounded-lg` only for muted surfaces (`bg-muted/50`) and skeleton placeholders.
- Prefer the `Card` component from `components/ui/card` over raw divs with card-like classes.

---

## Page Layout

| Token | Classes | Usage |
| --- | --- | --- |
| View wrapper | `max-w-xl mx-auto space-y-6` | Top-level wrapper for each view (HomeView, SettingsView, etc.) |
| Section spacing | `space-y-6` | Between major sections |
| Inner section spacing | `space-y-2` | Within sections (e.g. label + input) |
| Content padding | Inherited from parent | Parent (`AppPageClient`) provides `container mx-auto px-4` |

### Rules

- Views must NOT add their own `px-*` or `py-*` to the wrapper div. The parent layout provides horizontal padding.
- Use `max-w-xl mx-auto` to constrain content width.

---

## Sheet and Dialog Headers

| Token | Classes | Usage |
| --- | --- | --- |
| Sheet header | `sticky top-0 z-10 border-b bg-background px-4 h-14 flex items-center justify-between` | Sticky header bar inside sheets |
| Sheet title | `font-semibold text-lg` | Title text in sheet headers |
| Sheet content area | `flex-1 overflow-y-auto px-4 py-6` | Scrollable content below header |
| Sheet footer | `sticky bottom-0 border-t bg-background px-4 py-4` | Pinned footer with actions |

### Rules

- Always include `bg-background` on sheet headers to prevent content showing through on scroll.
- Sheet max-width: `w-full sm:max-w-md` (standard) or `w-full sm:max-w-[380px]` (narrow, e.g. settings).

---

## Icons

| Size | Classes | Usage |
| --- | --- | --- |
| Standard | `h-4 w-4` | Default icon size (buttons, inline) |
| Large | `h-5 w-5` | Header actions, prominent icons |
| Small | `h-3.5 w-3.5` | Compact contexts (legend, inline badges) |

### Rules

- Always use `h-X w-X` syntax. Never use `size-X` for icon dimensions.
- Use `text-muted-foreground` as the default icon color unless the icon has semantic meaning.

---

## Semantic Colors

| Token | Classes | Usage |
| --- | --- | --- |
| Success | `text-success` | Completed/done states, mastered cards |
| Success (dark hover) | `dark:hover:bg-green-950/30` | Dark mode hover backgrounds |
| Warning / hide | `text-warning` | Hidden cards, caution states |
| Warning (dark hover) | `dark:hover:bg-orange-950/30` | Dark mode hover backgrounds |
| Active accent | `text-primary` | Active/selected item text |
| Destructive | `text-destructive` | Delete, sign out actions |
| Muted icon/text | `text-muted-foreground` | Secondary, de-emphasized elements |

### Rules

- Always use `text-success` for success states. Never use `text-green-500` or `text-green-600` directly.
- Always use `text-warning` for warning states. Never use `text-orange-600` directly.
- Use semantic classes (`text-success`, `text-warning`, `text-primary`, `text-destructive`) over raw color values whenever a semantic match exists.

---

## Buttons

| Pattern | Classes | Usage |
| --- | --- | --- |
| Primary CTA | `Button size="lg" className="w-full gap-2"` | Main page action (e.g. Start Learning) |
| Secondary | `Button variant="outline"` | Alternative actions |
| Ghost icon | `Button variant="ghost" size="icon"` | Icon-only buttons (close, settings) |
| Small action | `Button size="sm" className="gap-1.5"` | Inline actions (add cards, select) |
| Destructive | `Button variant="destructive" className="w-full"` | Destructive actions (sign out) |

---

## Badges

| Pattern | Classes | Usage |
| --- | --- | --- |
| Outline badge | `Badge variant="outline" className="text-xs"` | Metadata labels (phase, status) |
| Secondary badge | `Badge variant="secondary" className="text-xs"` | Count indicators |

---

## Skeletons and Loading

| Pattern | Classes | Usage |
| --- | --- | --- |
| Card skeleton | `Skeleton className="h-48 w-full rounded-xl"` | Placeholder for cards |
| Row skeleton | `Skeleton className="h-14 w-full rounded-xl"` | Placeholder for list items |
| Small skeleton | `Skeleton className="h-12 w-full rounded-lg"` | Placeholder for controls |

---

## Spacing Reference

| Scale | Value | Common usage |
| --- | --- | --- |
| `gap-1` / `space-y-1` | 4px | Tight grouping |
| `gap-1.5` / `space-y-1.5` | 6px | Badge groups, dot indicators |
| `gap-2` / `space-y-2` | 8px | Label + input, inner sections |
| `gap-3` / `space-y-3` | 12px | Card internal spacing |
| `gap-4` / `space-y-4` | 16px | Card content sections |
| `gap-6` / `space-y-6` | 24px | Major section spacing |
