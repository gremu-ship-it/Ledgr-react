import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    locale: z.enum(['en', 'ny']),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
  }),
});

const help = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/help' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    locale: z.enum(['en', 'ny']),
    category: z.string().default('Getting started'),
    /** Lower number = higher up the index. */
    order: z.number().default(100),
  }),
});

export const collections = { blog, help };
