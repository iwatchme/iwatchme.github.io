import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import fg from "fast-glob";
import matter from "gray-matter";
import fse from "fs-extra";
import slugify from "slugify";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const contentDir = path.join(projectRoot, "src", "content", "blog");
const publicPostsDir = path.join(projectRoot, "public", "posts");
const defaultImportTags = ["android", "android-framework"];

function parseArgs(argv) {
  const options = {
    source: [],
    tags: []
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--vault" && next) {
      options.vault = next;
      index += 1;
      continue;
    }

    if (arg === "--source" && next) {
      options.source.push(next);
      index += 1;
      continue;
    }

    if (arg === "--slug" && next) {
      options.slug = next;
      index += 1;
      continue;
    }

    if (arg === "--title" && next) {
      options.title = next;
      index += 1;
      continue;
    }

    if (arg === "--pub-date" && next) {
      options.pubDate = next;
      index += 1;
      continue;
    }

    if (arg === "--tag" && next) {
      options.tags.push(next);
      index += 1;
      continue;
    }
  }

  return options;
}

function humanizeFilename(sourcePath) {
  return path
    .basename(sourcePath, path.extname(sourcePath))
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function createSlug(value, fallback) {
  const fromValue = slugify(value ?? "", {
    lower: true,
    strict: true,
    trim: true
  });

  if (fromValue) {
    return fromValue;
  }

  return slugify(fallback, {
    lower: true,
    strict: true,
    trim: true
  });
}

function normalizeTags(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value
      .flatMap((entry) =>
        typeof entry === "string" ? entry.split(",") : []
      )
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  return [];
}

function normalizeDate(value, fallback = null) {
  if (!value) {
    return fallback ? normalizeDate(fallback) : fallback;
  }

  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date value: ${value}`);
  }

  return date.toISOString().slice(0, 10);
}

function extractTitle(content) {
  const match = content.match(/^#\s+(.+?)\s*$/m);
  return match?.[1]?.trim() ?? null;
}

function stripLeadingTitleHeading(content, title) {
  const headingPattern = new RegExp(
    `^#\\s+${escapeRegExp(title)}\\s*\\n+`
  );
  return content.replace(headingPattern, "");
}

function stripManualToc(content) {
  return content.replace(/\n---\s*\n+\s*## 目录[\s\S]*?\n---\s*\n+/u, "\n\n");
}

function extractDescription(content) {
  const withoutCode = content.replace(/```[\s\S]*?```/g, "");
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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertNoObsidianOnlySyntax(content, sourcePath) {
  const checks = [
    {
      label: "wikilinks",
      pattern: /(?<!!)\[\[[^\]]+\]\]/u
    },
    {
      label: "embeds",
      pattern: /!\[\[[^\]]+\]\]/u
    },
    {
      label: "callouts",
      pattern: /^>\s*\[![^\]]+\]/mu
    },
    {
      label: "block references",
      pattern: /^\^[\w-]+\s*$/mu
    },
    {
      label: "Obsidian comments",
      pattern: /%%/u
    }
  ];

  for (const check of checks) {
    if (check.pattern.test(content)) {
      throw new Error(
        `Unsupported ${check.label} syntax found in ${sourcePath}. Convert it to standard Markdown before syncing.`
      );
    }
  }
}

function copyImageAsset(sourceFile, rawTarget, slug, emittedAssets) {
  const decodedTarget = decodeURIComponent(rawTarget.replace(/^<|>$/g, ""));
  const absoluteSource = path.resolve(path.dirname(sourceFile), decodedTarget);

  if (!fs.existsSync(absoluteSource)) {
    throw new Error(`Image not found: ${absoluteSource}`);
  }

  const existing = emittedAssets.get(absoluteSource);
  if (existing) {
    return existing;
  }

  const ext = path.extname(absoluteSource);
  const name = path.basename(absoluteSource, ext);
  let candidate = `${createSlug(name, "asset")}${ext.toLowerCase()}`;
  let counter = 2;

  while ([...emittedAssets.values()].includes(candidate)) {
    candidate = `${createSlug(name, "asset")}-${counter}${ext.toLowerCase()}`;
    counter += 1;
  }

  const outputDir = path.join(publicPostsDir, slug);
  fse.ensureDirSync(outputDir);
  fse.copyFileSync(absoluteSource, path.join(outputDir, candidate));
  emittedAssets.set(absoluteSource, candidate);
  return candidate;
}

function rewriteImageLinks(content, sourceFile, slug) {
  const emittedAssets = new Map();

  return content.replace(
    /!\[([^\]]*)\]\((<[^>]+>|[^)\s]+)(?:\s+"([^"]*)")?\)/g,
    (full, alt, target, title) => {
      const cleanedTarget = target.replace(/^<|>$/g, "");

      if (
        cleanedTarget.startsWith("http://") ||
        cleanedTarget.startsWith("https://") ||
        cleanedTarget.startsWith("data:") ||
        cleanedTarget.startsWith("/")
      ) {
        return full;
      }

      const assetName = copyImageAsset(sourceFile, target, slug, emittedAssets);
      const titleSuffix = title ? ` "${title}"` : "";
      return `![${alt}](/posts/${slug}/${assetName}${titleSuffix})`;
    }
  );
}

function writePost(outputPath, frontmatter, content) {
  const fileBody = matter.stringify(content.trim() + "\n", frontmatter);
  fse.ensureDirSync(path.dirname(outputPath));
  fs.writeFileSync(outputPath, fileBody);
}

function getSourceEntries(options) {
  const entries = [];
  const seen = new Set();

  if (options.vault ?? process.env.OBSIDIAN_VAULT_PATH) {
    const vaultPath = path.resolve(options.vault ?? process.env.OBSIDIAN_VAULT_PATH);
    const files = fg.sync("**/*.md", {
      cwd: vaultPath,
      absolute: true,
      ignore: ["**/.obsidian/**", "**/.git/**", "**/node_modules/**"]
    });

    for (const file of files) {
      if (!seen.has(file)) {
        entries.push({ kind: "vault", file });
        seen.add(file);
      }
    }
  }

  for (const file of options.source) {
    const absolute = path.resolve(file);
    if (!seen.has(absolute)) {
      entries.push({ kind: "source", file: absolute });
      seen.add(absolute);
    }
  }

  return entries;
}

function buildFrontmatter({ sourcePath, kind, data, content, options }) {
  const autoTitle = extractTitle(content) ?? humanizeFilename(sourcePath);
  const title = options.title ?? data.title ?? autoTitle;
  const slug =
    options.slug ??
    data.slug ??
    createSlug(title, humanizeFilename(sourcePath));
  const description = data.description ?? extractDescription(content);
  const pubDate = normalizeDate(
    data.pubDate ?? data.date ?? options.pubDate,
    new Date()
  );
  const updatedDate = normalizeDate(
    data.updatedDate ?? data.updated ?? data.lastModified,
    null
  );
  const tags = normalizeTags(data.tags);
  const finalTags =
    tags.length > 0
      ? tags
      : kind === "source"
        ? options.tags.length > 0
          ? options.tags
          : defaultImportTags
        : [];

  if (kind === "vault" && (!data.publish || data.draft)) {
    return null;
  }

  if (kind === "vault" && finalTags.length === 0) {
    throw new Error(`Missing tags in publishable note: ${sourcePath}`);
  }

  return {
    title,
    description,
    pubDate,
    ...(updatedDate ? { updatedDate } : {}),
    tags: finalTags,
    draft: false,
    publish: true,
    slug
  };
}

function syncEntry(entry, options, seenSlugs) {
  const sourcePath = entry.file;
  const raw = fs.readFileSync(sourcePath, "utf8");
  const parsed = matter(raw);
  const frontmatter = buildFrontmatter({
    sourcePath,
    kind: entry.kind,
    data: parsed.data,
    content: parsed.content,
    options
  });

  if (!frontmatter) {
    return null;
  }

  if (seenSlugs.has(frontmatter.slug)) {
    throw new Error(`Duplicate slug detected: ${frontmatter.slug}`);
  }

  let content = parsed.content.replace(/\r\n/g, "\n").trim();
  content = stripLeadingTitleHeading(content, frontmatter.title);
  content = stripManualToc(content);
  assertNoObsidianOnlySyntax(content, sourcePath);
  content = rewriteImageLinks(content, sourcePath, frontmatter.slug);

  const outputFile = path.join(contentDir, `${frontmatter.slug}.md`);
  writePost(outputFile, frontmatter, content);
  seenSlugs.add(frontmatter.slug);

  return {
    slug: frontmatter.slug,
    outputFile
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const entries = getSourceEntries(options);

  if (entries.length === 0) {
    throw new Error(
      "No sources found. Provide --vault, set OBSIDIAN_VAULT_PATH, or pass --source /path/to/article.md."
    );
  }

  fse.ensureDirSync(contentDir);
  fse.ensureDirSync(publicPostsDir);

  const seenSlugs = new Set();
  const written = [];

  for (const entry of entries) {
    const result = syncEntry(entry, options, seenSlugs);
    if (result) {
      written.push(result);
    }
  }

  if (written.length === 0) {
    console.log("No publishable notes were synced.");
    return;
  }

  for (const item of written) {
    console.log(`Synced ${item.slug} -> ${path.relative(projectRoot, item.outputFile)}`);
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
