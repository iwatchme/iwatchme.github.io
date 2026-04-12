# iwatchme.github.io

Astro-powered blog source for `https://iwatchme.github.io`, with local writing managed in Obsidian and deployment handled by GitHub Actions.

## Stack

- Astro content collections for posts
- GitHub Pages + GitHub Actions for deployment
- Obsidian as the local authoring source of truth
- A strict sync step that rejects Obsidian-only syntax in published notes

## Local development

```bash
npm install
npm run dev
```

`npm run dev` now does an initial sync from the `Notes` vault and keeps watching it for Markdown and image changes while Astro is running.

## Writing flow

1. Write notes anywhere inside your Obsidian vault.
2. Add frontmatter to notes you want to publish:

```yaml
---
title: Android 绘制策略——完整指南
slug: android-draw-strategy-complete-guide
pubDate: 2026-04-11
tags:
  - android
  - android-framework
publish: true
draft: false
description: 从 invalidate 和 requestLayout 出发，梳理 Android 绘制链路直到 SurfaceFlinger 合成显示。
---
```

3. Sync publishable notes into this repo:

```bash
npm run sync:notes
```

`npm run sync:notes` will resolve the `Notes` vault path via the Obsidian CLI automatically.

4. Preview locally:

```bash
npm run dev
```

Saving a publishable note in Obsidian will automatically re-sync it into `src/content/blog/` during local development.

5. Push to `master` and let GitHub Actions deploy the site.

## One-off imports

You can import a standalone Markdown file even if it does not already contain frontmatter:

```bash
npm run sync:obsidian -- \
  --source /absolute/path/to/article.md \
  --slug android-draw-strategy-complete-guide
```

If the source file has no tags, the importer will default to `android` and `android-framework`.

## Published Markdown rules

Published notes must stay within a pure Markdown subset so Astro can render them reliably:

- Allowed:
  - frontmatter
  - standard Markdown headings, lists, tables, links, and images
  - fenced code blocks
  - Mermaid fenced blocks
- Rejected by the sync script:
  - `[[wikilink]]`
  - `![[embed]]`
  - Obsidian callouts like `> [!note]`
  - standalone block references like `^block-id`
  - Obsidian `%% comments %%`

## Images

- Put local images next to your Obsidian note or in a nearby relative path.
- The sync script copies them into `public/posts/<slug>/`.
- Markdown image URLs are rewritten to `/posts/<slug>/<filename>`.

## Repository structure

- `src/content/blog/`: published Markdown source
- `public/posts/<slug>/`: copied image assets
- `scripts/sync-obsidian.mjs`: Obsidian-to-blog sync tool
- `.github/workflows/deploy.yml`: GitHub Pages deployment workflow

## GitHub Pages setup

In the repository settings:

1. Open `Settings` → `Pages`
2. Set `Source` to `GitHub Actions`
3. Keep the default environment name `github-pages`

Official references:

- [Astro GitHub Pages deployment guide](https://docs.astro.build/zh-cn/guides/deploy/github/)
- [GitHub Pages custom workflow guide](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
