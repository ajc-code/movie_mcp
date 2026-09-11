import { createMcpHandler } from 'mcp-handler';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';

const handler = createMcpHandler((server) => {
  server.registerTool(
    'add_movie',
    {
      title: 'Add Movie',
      description: 'Add a new movie to the watchlist. Use when the user asks to add, ' +
        'save, or note down a movie they want to watch.',
      inputSchema: z.object({
        title: z.string().describe('The movie title, e.g. "Oppenheimer"'),
      }),
    },
    async ({ title }) => {
      const { error } = await supabase
        .from('movies')
        .insert({ title });
      if (error) throw new Error(error.message);
      return { content: [{ type: 'text', text: `Added "${title}" to the watchlist.` }] };
    }
  );

  server.registerTool(
    'mark_watched',
    {
      title: 'Mark Watched',
      description: 'Mark a movie as watched. Use when the user says they watched, ' +
        'finished, or saw a movie that is on their list.',
      inputSchema: z.object({
        title: z.string().describe('The movie title to mark as watched'),
      }),
    },
    async ({ title }) => {
      const { error } = await supabase
        .from('movies')
        .update({ watched: true, watched_at: new Date().toISOString() })
        .eq('title', title);
      if (error) throw new Error(error.message);
      return { content: [{ type: 'text', text: `Marked "${title}" as watched.` }] };
    }
  );

  server.registerTool(
    'toggle_favourite',
    {
      title: 'Toggle Favourite',
      description: 'Mark or unmark a movie as a favourite. Use when the user says they ' +
        'loved, favourited, or wants to unfavourite a movie.',
      inputSchema: z.object({
        title: z.string().describe('The movie title to toggle'),
      }),
    },
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

  server.registerTool(
    'get_watchlist',
    {
      title: 'Get Watchlist',
      description: 'Get the list of movies not yet watched. Use when the user asks ' +
        'what to watch, or what is on their list.',
      inputSchema: z.object({}),
    },
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

  server.registerTool(
    'get_recent',
    {
      title: 'Get Recent',
      description: 'Get the most recently watched movies. Use when the user asks what ' +
        'they have watched lately or recently.',
      inputSchema: z.object({
        n: z.number().describe('How many recent movies to return').default(10),
      }),
    },
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
