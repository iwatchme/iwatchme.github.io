import type { CollectionEntry } from "astro:content";

export type BlogPost = CollectionEntry<"blog">;

export function byNewest(a: BlogPost, b: BlogPost) {
  return b.data.pubDate.getTime() - a.data.pubDate.getTime();
}

export function sortPosts(posts: BlogPost[]) {
  return [...posts].sort(byNewest);
}

export function formatDate(date: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric"
  }).format(date);
}

export function getPostUrl(post: BlogPost) {
  return `/posts/${post.slug}/`;
}

export function extractMarkdownSummary(markdown: string) {
  const withoutFrontmatter = markdown
    .replace(/\r\n/g, "\n")
    .replace(/^---\n[\s\S]*?\n---\n*/u, "");
  const withoutCode = withoutFrontmatter.replace(/```[\s\S]*?```/g, "");
  const paragraphs = withoutCode
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  for (const paragraph of paragraphs) {
    if (paragraph.startsWith("## ")) {
      continue;
    }

    if (paragraph.startsWith(">")) {
      return paragraph.replace(/^>\s?/gm, "").replace(/\s+/g, " ").trim();
    }

    if (!paragraph.startsWith("#")) {
      return paragraph.replace(/\s+/g, " ").trim();
    }
  }

  return "";
}

export function getPostSummary(post: BlogPost) {
  return extractMarkdownSummary(post.body) || post.data.description || "";
}

export function getTagUrl(tag: string) {
  return `/tags/${encodeURIComponent(tag)}/`;
}

export function getAllTags(posts: BlogPost[]) {
  const counts = new Map<string, number>();

  for (const post of posts) {
    for (const tag of post.data.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => a.tag.localeCompare(b.tag, "zh-CN"));
}

export function getPostsByTag(posts: BlogPost[], tag: string) {
  return sortPosts(posts.filter((post) => post.data.tags.includes(tag)));
}

export function getArchiveGroups(posts: BlogPost[]) {
  const groups = new Map<number, BlogPost[]>();

  for (const post of sortPosts(posts)) {
    const year = post.data.pubDate.getFullYear();
    const bucket = groups.get(year) ?? [];
    bucket.push(post);
    groups.set(year, bucket);
  }

  return [...groups.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([year, entries]) => ({ year, entries }));
}
