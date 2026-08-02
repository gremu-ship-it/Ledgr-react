// RSS feed for the English blog.
import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';

export async function GET(context: { site: string }) {
  const posts = (await getCollection('blog'))
    .filter((p) => p.data.locale === 'en' && !p.data.draft)
    .sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());

  return rss({
    title: 'Ledgr Blog',
    description: 'Practical guides for Malawian SMEs — tax, bookkeeping and business finance.',
    site: context.site,
    items: posts.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.pubDate,
      link: `/en/blog/${post.id.split('/').pop()}/`,
    })),
    customData: `<language>en</language>`,
  });
}
