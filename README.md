# Flexling

## Tech stack

- **Frontend**: [Next.js 16](https://nextjs.org/) with React 19
- **Backend/Database**: [Convex](https://convex.dev/) - real-time backend with automatic sync
- **Authentication**: [Better Auth](https://www.better-auth.com/) with [@convex-dev/better-auth](https://www.npmjs.com/package/@convex-dev/better-auth)
- **UI Components**: [shadcn/ui](https://ui.shadcn.com/) - beautifully designed components
- **Styling**: [Tailwind CSS 4](https://tailwindcss.com/)

---

## Getting started

### Prerequisites

- Node.js 20+ (CI pins 20)
- pnpm

### Installation

```bash
# Install dependencies
pnpm install
```

### Setup environment variables

#### Local development

Make sure Docker is running and run:

```bash
docker compose up
```

Then run the following:

```bash
docker compose exec backend ./generate_admin_key.sh
```

Create a `.env.local` file in the root directory with and set the admin key and other variables:

```
CONVEX_SELF_HOSTED_URL='http://127.0.0.1:3210'
CONVEX_SELF_HOSTED_ADMIN_KEY='convex-self-hosted|XXX'
NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3210
NEXT_PUBLIC_CONVEX_SITE_URL=http://127.0.0.1:3211
# BETTER_AUTH_SECRET=your-secret-here # has to be the same as the one set in the convex dashboard
SITE_URL=http://localhost:3000
```

You also have to set SITE_URL and BETTER_AUTH_SECRET in the convex dashboard.

#### Develop against Convex dev/prod environment

For developing against the cloud instance, you can take the URLS and keys from the convex dashboard.

```env
# Convex
CONVEX_DEPLOYMENT=dev:your-deployment-name
NEXT_PUBLIC_CONVEX_URL=https://your-deployment.convex.cloud
NEXT_PUBLIC_CONVEX_SITE_URL=XXX

# Better Auth (if using social providers)
# BETTER_AUTH_SECRET=your-secret-here # has to be the same as the one set in the convex dashboard
SITE_URL=http://localhost:3000
```

### Development

```bash
# Start both frontend and backend in development mode
pnpm dev

# Or run them separately:
pnpm dev:frontend  # Next.js on http://localhost:3000
pnpm dev:backend   # Convex dev server

# seeding the texts
pnpm seed-texts
```

### Other commands

```bash
# Type checking
pnpm typecheck         # tsc --noEmit over the app
pnpm typecheck:tests   # type-check the test files (tsconfig.test.json)

# Tests. See TESTING.md for the full guide
pnpm test              # all vitest projects (convex + app)
pnpm test:convex       # Convex backend tests only (edge-runtime)
pnpm test:app          # frontend tests only (jsdom)
pnpm test:coverage     # v8 coverage report
pnpm test:e2e          # Playwright (needs a dev server running)

# Lint & format
pnpm lint              # ESLint
pnpm lint:fix          # Prettier + ESLint --fix
pnpm format            # Prettier over the repo

# Build & deploy
pnpm build             # next build
pnpm start             # production server
pnpm build:deploy      # convex deploy (runs the build) + prod migrations

# Convex data snapshots (per git branch)
pnpm snapshot          # export deployment data to .convex-snapshots/<branch>.zip
pnpm snapshot:restore  # import that snapshot back (--replace)
```

The testing setup (vitest projects, Playwright phases, `@live` tagging, testid conventions) is documented in [TESTING.md](./TESTING.md).

---

# Git LFS

[Install Git LFS](https://docs.github.com/en/repositories/working-with-files/managing-large-files/installing-git-large-file-storage) if you haven't already.

The repo uses **`.lfsconfig`** so the currently largest input files (`data_preparation/data/inputs/sentences.csv`, ~708 MB) is excluded from LFS fetch by default. Other LFS files are still pulled on clone/pull, which keeps deploys (e.g. Coolify) fast and within GitHub LFS quota. 

- **When you need the big file** (e.g. to run the data-prep pipeline):
  ```bash
  git lfs pull --include="data_preparation/data/inputs/sentences.csv"
  ```
- To skip **all** LFS files on clone/pull, set `GIT_LFS_SKIP_SMUDGE=1` in your environment (e.g. deploy config).

---

# Working with LLMs

Here are relevant tutorials for making LLMs in cursor more accurate with the tech stack we are using:

## MCP servers and rules
Convex: https://docs.convex.dev/ai/using-cursor
BetterAuth: https://www.better-auth.com/docs/introduction#llmstxt
Follow the turorials on the websites to add MCP servers and docs

LLM.txt files:
BetterAuth https://www.better-auth.com/llms.txt
BetterAuthUi: https://better-auth-ui.com/llms.txt
Shadcn: https://ui.shadcn.com/llms.txt
Vercel AI SDK: https://ai-sdk.dev/llms.txt
To add these go Cursor->Cursor Settings->Indexing and Docs

You can also add the MCP Servers for Convex, BetterAuth and AI Elements by setting the following for MCP servers in the Cursor settings

```
{
  "mcpServers": {
    "convex": {
      "command": "npx -y convex@latest mcp start",
      "env": {},
      "args": []
    },
    "Better Auth": {
      "url": "https://mcp.chonkie.ai/better-auth/better-auth-builder/mcp",
      "headers": {}
    },
    "ai-elements": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://registry.ai-sdk.dev/api/mcp"
      ]
    }
  }
}
```

# More things that are not setup related

## Project structure

```
├── app/                    # Next.js app router
│   ├── page.tsx            # Public landing page
│   ├── app/                # Authenticated app
│   │   ├── (main)/         # Main views (home, learn, library, stats, chat, …)
│   │   ├── onboarding/     # Onboarding wizard (language pair → placement → first lesson)
│   │   └── admin/          # Internal admin dashboard
│   ├── auth/[path]/        # Auth routes (sign-in, sign-up, etc.)
│   ├── api/auth/           # Better Auth API routes
│   └── legal/              # Legal pages
├── components/
│   ├── app/                # Product UI (learning, library, stats, home, settings, …)
│   ├── chat/               # AI chat UI
│   ├── autumn/             # Billing / pricing UI
│   ├── course/, home/, landing/, admin/, …
│   └── ui/                 # shadcn/ui components
├── convex/                 # Convex backend
│   ├── schema.ts           # Database schema
│   ├── features/           # Domain queries/mutations/actions (courses, decks, scheduling, chat, …)
│   ├── db/                 # Table-level data-access helpers
│   ├── lib/                # Shared backend logic (card content, TTS, STT, …)
│   ├── usage/              # Autumn usage/quota tracking
│   ├── admin/              # Admin & warmup operations
│   ├── migrations/         # Dataset cutover + seed/ops utilities
│   ├── billing.ts          # Billing enforcement
│   ├── auth.ts             # Better Auth server config
│   ├── tests/              # Backend vitest tests (see TESTING.md)
│   └── _generated/         # Auto-generated Convex types
├── lib/                    # Frontend/shared utilities (languages, scheduling, textCompare, autumn, tutorials, …)
├── hooks/                  # Custom React hooks
├── i18n/                   # next-intl setup
├── messages/               # Locale files (en.json, de.json)
├── tests/                  # Frontend vitest tests (see TESTING.md)
├── e2e/                    # Playwright specs (see TESTING.md)
├── documentation/          # Architecture & feature docs
└── scripts/                # One-off / maintenance scripts
```

---

## Recommended VS Code extensions

Install the **Tailwind CSS IntelliSense** extension for:

- Autocomplete for Tailwind classes
- Syntax highlighting
- Linting for class conflicts

[Install Tailwind CSS IntelliSense](https://marketplace.visualstudio.com/items?itemName=bradlc.vscode-tailwindcss)

---

## shadcn/ui

This project uses [shadcn/ui](https://ui.shadcn.com/) for UI components. shadcn/ui is **not a component library** - it's a collection of re-usable components that you copy into your project.

### Adding components

```bash
# Add a new component
pnpm dlx shadcn@latest add button

# Add multiple components
pnpm dlx shadcn@latest add card dialog tabs
```

### Configuration

The shadcn config is in `components.json`:

- **Style**: new-york
- **Base color**: slate
- **CSS variables**: enabled
- **Icons**: lucide-react

Components are installed to `components/ui/` and can be freely modified.

---

## Better Auth

[Better Auth](https://www.better-auth.com/) handles authentication with support for:

- Email/password authentication
- Social providers (Google, GitHub, etc.)
- Session management

### Client usage

```tsx
import { authClient } from '@/lib/auth-client';

// Sign in
await authClient.signIn.email({ email, password });

// Sign up
await authClient.signUp.email({ email, password, name });

// Sign out
await authClient.signOut();

// Get session (React hook)
const { data: session, isPending } = authClient.useSession();
```

### UI components

The project includes pre-built auth UI from `@daveyplate/better-auth-ui`:

```tsx
import { SignedIn, SignedOut, UserButton } from "@daveyplate/better-auth-ui";

<SignedOut>
  {/* Show when user is not authenticated */}
</SignedOut>

<SignedIn>
  <UserButton />
</SignedIn>
```

---

## Convex

[Convex](https://convex.dev/) is the real-time backend providing:

- **Database**: Automatic schema-based NoSQL database
- **Queries**: Real-time reactive queries
- **Mutations**: Transactional writes
- **Actions**: Server-side functions for external APIs

### Writing functions

Real modules live under `convex/features/` (e.g. `convex/features/library.ts` exports `getLibraryCards`). The snippet below is a generic illustration of the function syntax. See `convex/_generated/ai/guidelines.md` for the project's authoritative Convex patterns.

```typescript
// convex/features/<feature>.ts (illustrative)
import { query, mutation } from "../_generated/server";
import { v } from "convex/values";

// Query - real-time data fetching
export const listItems = query({
  args: { limit: v.number() },
  returns: v.array(v.object({ ... })),
  handler: async (ctx, args) => {
    return await ctx.db.query("items").take(args.limit);
  },
});

// Mutation - data modification
export const createItem = mutation({
  args: { name: v.string() },
  returns: v.id("items"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("items", { name: args.name });
  },
});
```

### Client usage

```tsx
import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

// Use query; it re-renders automatically when the data changes. Function refs
// mirror the file layout, e.g. convex/features/library.ts → api.features.library.*
const cards = useQuery(api.features.library.getLibraryCards, {
  activeFilter: 'favorites',
});

// Use mutation. This one is illustrative; see convex/features/ for real ones.
const createItem = useMutation(api.features.example.createItem);
await createItem({ name: 'New Item' });
```

### Convex dashboard

Access your Convex dashboard to view data, logs, and manage deployments:

```bash
pnpm exec convex dashboard
```

---

## Learn more

- [Convex Documentation](https://docs.convex.dev/)
- [Better Auth Documentation](https://www.better-auth.com/docs)
- [shadcn/ui Documentation](https://ui.shadcn.com/docs)
- [Next.js Documentation](https://nextjs.org/docs)
- [Tailwind CSS Documentation](https://tailwindcss.com/docs)
