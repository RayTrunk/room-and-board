// PROTOTYPE — throwaway Starlight scaffold, branch proto/starlight-docs.
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://docs.idlescreen.app',
  integrations: [
    starlight({
      title: 'idlescreen',
      tagline: 'A dashboard for your idle screen',
      logo: { src: './public/idlescreen-mark.svg', alt: 'idlescreen' },
      favicon: '/idlescreen-favicon-32.png',
      description:
        'Docs for idlescreen: a lightweight signage dashboard for Cisco Board Pro and Desk Pro. Setup, widgets, gestures, and self-hosting.',
      customCss: ['./src/styles/idlescreen.css'],
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/scotty83/idlescreen' },
      ],
      editLink: {
        baseUrl: 'https://github.com/scotty83/idlescreen/edit/dev/docs-site/',
      },
      lastUpdated: true,
      sidebar: [
        {
          label: 'Start here',
          items: [
            { label: 'What idlescreen is', slug: 'what-it-is' },
            { label: 'Quick start', slug: 'quick-start' },
          ],
        },
        {
          label: 'Guides',
          items: [
            { label: 'Get it on a board', slug: 'guides/get-it-on-a-board' },
            { label: 'Make it yours', slug: 'guides/make-it-yours' },
            { label: 'Screensavers', slug: 'guides/screensavers' },
            { label: 'Photos and video', slug: 'guides/photos-and-video' },
          ],
        },
        {
          label: 'Widgets',
          items: [
            { label: 'Overview', slug: 'widgets/overview' },
            { label: 'Commute', slug: 'widgets/commute' },
            { label: 'Weather and air', slug: 'widgets/weather-and-air' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'Gestures and touch', slug: 'reference/gestures' },
            { label: 'Configuration string', slug: 'reference/configuration' },
            { label: 'Addresses', slug: 'reference/addresses' },
          ],
        },
        {
          label: 'Self-hosting',
          items: [
            { label: 'Local development', slug: 'develop/local' },
            { label: 'Deployment', slug: 'develop/deployment' },
            { label: 'Data sources', slug: 'develop/data-sources' },
          ],
        },
      ],
    }),
  ],
});
