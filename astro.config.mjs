import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  site: "https://iwatchme.github.io",
  integrations: [sitemap()],
  markdown: {
    shikiConfig: {
      themes: {
        light: "github-light",
        dark: "github-dark"
      }
    }
  }
});
