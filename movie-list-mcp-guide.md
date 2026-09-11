# Movie list via Claude — step-by-step build guide

A simple project: a Supabase database holds your movie list, a small MCP
server exposes tools to read/write it, Vercel hosts the server, and Claude
connects to it so you can manage the list just by talking.

---

## Step 1 — Create the database (Supabase)

**Platform: Supabase**

1. Go to supabase.com, sign up, create a new project.
2. Open the SQL editor and create the table:

```sql
create table movies (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  added_at timestamptz default now(),
  watched boolean default false,
  watched_at timestamptz,
  favourite boolean default false,
  notes text
);
```

3. That's it — Supabase auto-generates a REST API on top of this table
   immediately. You don't need to write any API code yourself.

### Which API key to use

Supabase has two key systems. The older one (`anon` / `service_role`) is
being phased out — use the newer one instead:

- **Publishable key** (`sb_publishable_...`) — low privilege, safe to
  expose in a browser. You don't need this for this project — it only
  matters later if you build a web dashboard that talks to Supabase
  directly from the browser.
- **Secret key** (`sb_secret_...`) — elevated privilege, bypasses Row
  Level Security, only ever used server-side. **This is the one your MCP
  server uses.**

To get it: Project Settings → API Keys → look for a "Publishable and
secret API keys" tab (separate from the legacy JWT keys). If your
project doesn't have them yet, there's a "Create new API keys" button —
click it, this adds the new keys alongside the old ones without
breaking anything. Copy the secret key and keep it somewhere safe
(you'll paste it into Vercel in Step 3, not into your code).

### Row Level Security (optional but recommended)

In Table Editor, open the `movies` table and toggle "Enable Row Level
Security." Your MCP server uses the secret key, which bypasses RLS
entirely, so this doesn't affect your actual read/write path today —
it's a safety net in case the publishable key ever ends up in a
browser-facing app later.

---

## Step 2 — Write the MCP server (your code, in GitHub)

**Platform: your machine / GitHub repo**

This is the part that turns "a database" into "something Claude can talk
to." Here's what's actually involved, piece by piece.

### 2a. What an "MCP handler" actually is

MCP (Model Context Protocol) defines a standard shape for how an AI
model asks a server "what tools do you have" and "run this tool with
these arguments." Writing that request/response handling from scratch —
parsing the protocol messages, matching tool names, returning results in
the right format — is boilerplate you don't want to hand-write.

`mcp-handler` is a small library (there's an official one for
TypeScript, and community ones for Python) that does that boilerplate
for you. You give it a list of tool definitions; it turns them into a
working MCP server that speaks the protocol correctly. Practically:
it's an npm package you install, the same way you'd install any
library — not a separate platform or service.

### 2b. Set up the project

```bash
mkdir movie-mcp
cd movie-mcp
npm init -y
npm install mcp-handler @supabase/supabase-js zod
```

- `mcp-handler` — the protocol boilerplate described above.
- `@supabase/supabase-js` — the official client library for talking to
  your Supabase project (reading/writing the `movies` table).
- `zod` — used to describe each tool's parameters in a way `mcp-handler`
  understands (this is what becomes the "parameter schema" Claude reads).

### Project folder structure

After the steps below, your repo should look like this:

```
movie-mcp/
├── api/
│   └── mcp.js          ← the MCP server itself (Step 2d) — Vercel
│                          turns this file into the live endpoint
├── lib/
│   └── supabase.js      ← the Supabase connection (Step 2c)
├── node_modules/         ← installed packages (created by npm, never
│                          committed — see .gitignore below)
├── package.json          ← created by `npm init`, lists your dependencies
├── package-lock.json     ← created by `npm install`, pins exact versions
├── .gitignore             ← tell git to ignore node_modules and secrets
└── .env.local             ← your Supabase URL/key for testing locally
                             (never committed — matches what you'll set
                             in Vercel's Environment Variables in Step 3)
```

Two files worth creating right away, before you write any tool code:

`.gitignore`:
```
node_modules/
.env.local
```

`.env.local` (for testing on your own machine before deploying):
```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SECRET_KEY=sb_secret_...
```

The `api/` folder name matters — it's the Next.js/Vercel convention that
turns a file into a live API route automatically, which is why
`api/mcp.js` becomes reachable at `/api/mcp` once deployed (Step 3).
`lib/` is just a normal convention for shared code that isn't itself a
route — you could call it anything, `lib` is just the common name.

### 2c. Connect to Supabase

Create a file `lib/supabase.js`:

```js
import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);
```

`process.env.SUPABASE_URL` and `SUPABASE_SECRET_KEY` are environment
variables — you set the actual values in Vercel in Step 3, never
hardcoded here. This keeps secrets out of your GitHub repo.

### 2d. Define your tools

Create `api/mcp.js` (the exact path depends on your framework — this
example assumes a simple Next.js-style API route, which is the path
`mcp-handler`'s docs are built around):

```js
import { createMcpHandler } from 'mcp-handler';
import { z } from 'zod';
import { supabase } from '../lib/supabase';

const handler = createMcpHandler((server) => {
  server.tool(
    'add_movie',
    'Add a new movie to the watchlist. Use when the user asks to add, ' +
    'save, or note down a movie they want to watch.',
    { title: z.string().describe('The movie title, e.g. "Oppenheimer"') },
    async ({ title }) => {
      const { error } = await supabase
        .from('movies')
        .insert({ title });
      if (error) throw new Error(error.message);
      return { content: [{ type: 'text', text: `Added "${title}" to the watchlist.` }] };
    }
  );

  server.tool(
    'mark_watched',
    'Mark a movie as watched. Use when the user says they watched, ' +
    'finished, or saw a movie that is on their list.',
    { title: z.string().describe('The movie title to mark as watched') },
    async ({ title }) => {
      const { error } = await supabase
        .from('movies')
        .update({ watched: true, watched_at: new Date().toISOString() })
        .eq('title', title);
      if (error) throw new Error(error.message);
      return { content: [{ type: 'text', text: `Marked "${title}" as watched.` }] };
    }
  );

  server.tool(
    'toggle_favourite',
    'Mark or unmark a movie as a favourite. Use when the user says they ' +
    'loved, favourited, or wants to unfavourite a movie.',
    { title: z.string().describe('The movie title to toggle') },
    async ({ title }) => {
      const { data } = await supabase
        .from('movies')
        .select('favourite')
        .eq('title', title)
        .single();
      const { error } = await supabase
        .from('movies')
        .update({ favourite: !data.favourite })
        .eq('title', title);
      if (error) throw new Error(error.message);
      return { content: [{ type: 'text', text: `Updated favourite status for "${title}".` }] };
    }
  );

  server.tool(
    'get_watchlist',
    'Get the list of movies not yet watched. Use when the user asks ' +
    'what to watch, or what is on their list.',
    {},
    async () => {
      const { data, error } = await supabase
        .from('movies')
        .select('title, added_at, favourite')
        .eq('watched', false)
        .order('added_at', { ascending: false });
      if (error) throw new Error(error.message);
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    }
  );

  server.tool(
    'get_recent',
    'Get the most recently watched movies. Use when the user asks what ' +
    'they have watched lately or recently.',
    { n: z.number().describe('How many recent movies to return').default(10) },
    async ({ n }) => {
      const { data, error } = await supabase
        .from('movies')
        .select('title, watched_at, favourite')
        .eq('watched', true)
        .order('watched_at', { ascending: false })
        .limit(n);
      if (error) throw new Error(error.message);
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    }
  );
});

export { handler as GET, handler as POST };
```

Notice each tool has three parts, matching what was discussed earlier:
a **name** (`add_movie`), a **description** (the string explaining what
it does and when to use it — this is the main thing Claude reads to
decide), and a **parameter schema** (the `zod` object describing what
arguments it takes).

### 2e. Push to GitHub

```bash
git init
git add .
git commit -m "Initial MCP server"
git remote add origin <your-repo-url>
git push -u origin main
```

---

## Step 3 — Deploy the MCP server (Vercel)

**Platform: Vercel**

1. Go to vercel.com, connect your GitHub account, import the `movie-mcp`
   repo.
2. In Project Settings → Environment Variables, add:
   - `SUPABASE_URL` — your project URL from Supabase (Project Settings → API)
   - `SUPABASE_SECRET_KEY` — the secret key from Step 1
3. Deploy. Vercel gives you a live URL, e.g. `https://movie-mcp.vercel.app`.
4. Your MCP endpoint is reachable at that URL plus the path of the file
   you created — with the example above, `https://movie-mcp.vercel.app/api/mcp`.
5. Add auth on the endpoint so it isn't open to anyone who finds the URL.
   Start with a simple shared secret/API key check inside your handler if
   you want the fastest path; move to OAuth later if you want it hardened
   (Vercel's MCP deployment docs cover both).

---

## Step 4 — Connect Claude

**Platform: Claude (claude.ai settings)**

1. In Claude settings, add a **custom connector**.
2. Enter your Vercel MCP endpoint URL (e.g. `https://movie-mcp.vercel.app/api/mcp`).
3. Complete whichever auth step you set up in Step 3.
4. Once connected, the tools (`add_movie`, `get_watchlist`, etc.) are
   available in any conversation — no repo pull, no manual steps.

---

## Step 5 — Use it

Just talk to Claude normally:

- "Add Oppenheimer to my list"
- "Mark Dune as watched"
- "Favourite The Nice Guys"
- "What's on my watchlist?"
- "What have I watched recently?"

Claude picks the right tool from your descriptions and calls it — no forms,
no files, no GitHub.

---

## Notes for later (not needed to start)

- **"Suggest something to watch"** — this is reasoning, not a plain lookup.
  Once the basics work, this is where a *skill* is worth adding: it calls
  `get_watchlist()` + your favourites, applies some taste logic, and gives
  you a pick — rather than a raw tool call.
- **A visual dashboard** — start by just asking Claude to build one as a
  one-off artifact from your live data. Only build a standalone web app if
  you find yourself wanting to check it without asking Claude each time.
  If you do, that's when the publishable key comes into play.
- **Cost** — Supabase and Vercel free tiers comfortably cover this scale.
  No spend expected at this size.
