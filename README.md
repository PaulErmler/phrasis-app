# Phrasis

## Tech Stack

- **Frontend**: [Next.js 16](https://nextjs.org/) with React 19
- **Backend/Database**: [Convex](https://convex.dev/) - real-time backend with automatic sync
- **Authentication**: [Better Auth](https://www.better-auth.com/) with [@convex-dev/better-auth](https://www.npmjs.com/package/@convex-dev/better-auth)
- **UI Components**: [shadcn/ui](https://ui.shadcn.com/) - beautifully designed components
- **Styling**: [Tailwind CSS 4](https://tailwindcss.com/)

---

## Getting Started

### Prerequisites

- Node.js 18+
- pnpm

### Installation

```bash
# Install dependencies
pnpm install
```

### Setup Environment Variables

#### Local Development

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

#### Develop Against Convex Dev/Prod Environment

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

### Other Commands

```bash
# Build for production
pnpm build

# Start production server
pnpm start

# Run linting
pnpm lint
```

---
# Setting up git lfs 

```
https://docs.github.com/en/repositories/working-with-files/managing-large-files/installing-git-large-file-storage
```
---
# Working with LLMs
Here are relevant tutorials for making LLMs in cursor more accuracte with the tech stack we are using: 

# Working with LLMs

Here are relevant tutorials for making LLMs in cursor more accuracte with the tech stack we are using:

MCP Servers and rules:
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

## Project Structure

```
phrasis-app/
├── app/                    # Next.js app router
│   ├── page.tsx           # Landing page with auth
│   ├── app/page.tsx       # Authenticated app page
│   ├── auth/[path]/       # Auth routes (sign-in, sign-up, etc.)
│   └── api/auth/          # Better Auth API routes
├── components/
│   └── ui/                # shadcn/ui components
├── convex/                # Convex backend
│   ├── schema.ts          # Database schema
│   ├── myFunctions.ts     # Queries & mutations
│   ├── auth.ts            # Better Auth server config
│   └── _generated/        # Auto-generated Convex types
├── lib/
│   ├── auth-client.ts     # Better Auth client
│   └── utils.ts           # Utility functions (cn, etc.)
└── hooks/                 # Custom React hooks
```

---

## Recommended VS Code Extensions

Install the **Tailwind CSS IntelliSense** extension for:

- Autocomplete for Tailwind classes
- Syntax highlighting
- Linting for class conflicts

[Install Tailwind CSS IntelliSense](https://marketplace.visualstudio.com/items?itemName=bradlc.vscode-tailwindcss)

---

## shadcn/ui

This project uses [shadcn/ui](https://ui.shadcn.com/) for UI components. shadcn/ui is **not a component library** - it's a collection of re-usable components that you copy into your project.

### Adding Components

```bash
# Add a new component
npx shadcn@latest add button

# Add multiple components
npx shadcn@latest add card dialog tabs
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

### Client Usage

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

### UI Components

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

### Writing Functions

```typescript
// convex/myFunctions.ts
import { query, mutation } from "./_generated/server";
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

### Client Usage

```tsx
import { useQuery, useMutation } from 'convex/react';
import { api } from '../convex/_generated/api';

// Use query (automatically re-renders when data changes)
const items = useQuery(api.myFunctions.listItems, { limit: 10 });

// Use mutation
const createItem = useMutation(api.myFunctions.createItem);
await createItem({ name: 'New Item' });
```

### Convex Dashboard

Access your Convex dashboard to view data, logs, and manage deployments:

```bash
npx convex dashboard
```

---

## Learn More

- [Convex Documentation](https://docs.convex.dev/)
- [Better Auth Documentation](https://www.better-auth.com/docs)
- [shadcn/ui Documentation](https://ui.shadcn.com/docs)
- [Next.js Documentation](https://nextjs.org/docs)
- [Tailwind CSS Documentation](https://tailwindcss.com/docs)
