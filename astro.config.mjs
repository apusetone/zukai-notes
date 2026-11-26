// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import { site } from './src/site.config.ts';

export default defineConfig({
  // 地図の YAML で ID が重複したらビルドを止める
  prerenderConflictBehavior: 'error',
  integrations: [
    starlight({
      title: site.name,
      defaultLocale: 'root',
      locales: { root: { label: '日本語', lang: 'ja' } },
      customCss: ['katex/dist/katex.min.css', './src/styles/spec.css', './src/styles/links.css', './src/styles/starlight.css'],
      head: [
        // 検索エンジンに載せない
        { tag: 'meta', attrs: { name: 'robots', content: 'noindex, nofollow' } },
        { tag: 'link', attrs: { rel: 'preconnect', href: 'https://fonts.googleapis.com' } },
        { tag: 'link', attrs: { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: true } },
        {
          tag: 'link',
          attrs: {
            rel: 'stylesheet',
            href: 'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500&family=Noto+Sans+JP:wght@400;500;700&display=swap',
          },
        },
      ],
      components: {
        SocialIcons: './src/components/TopNav.astro',
        ThemeSelect: './src/components/Empty.astro',
        ThemeProvider: './src/components/LightTheme.astro',
      },
      pagination: true,
    }),
  ],
});
