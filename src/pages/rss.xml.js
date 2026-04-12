import rss from "@astrojs/rss";
import { getCollection } from "astro:content";
import { siteConfig } from "../site-config";
import { getPostSummary, getPostUrl, sortPosts } from "../utils/posts";

export async function GET(context) {
  const posts = sortPosts(
    await getCollection("blog", ({ data }) => data.publish && !data.draft)
  );

  return rss({
    title: siteConfig.title,
    description: siteConfig.description,
    site: context.site ?? siteConfig.siteUrl,
    items: posts.map((post) => ({
      title: post.data.title,
      description: getPostSummary(post),
      pubDate: post.data.pubDate,
      link: getPostUrl(post)
    }))
  });
}
