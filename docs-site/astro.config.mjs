// PROTOTYPE — branch proto/starlight-docs.
// The decision (2026-08-26): docs land at idlescreen.io/docs, beside the
// marketing front door, inside the same Pages project. `base` makes every
// generated URL, asset and the Pagefind index live under /docs.
// IA settled with Sean 2026-08-26 (grilling session): end-user docs only,
// no self-hosting content (GitHub carries that audience), per-widget pages
// nested under the app's own eight group labels.
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://idlescreen.io',
  base: '/docs',
  integrations: [
    starlight({
      title: 'idlescreen',
      tagline: 'A dashboard for your idle screen',
      components: { SiteTitle: './src/components/SiteTitle.astro' },
      favicon: '/idlescreen-favicon-32.png',
      description:
        'How to put idlescreen on your Cisco board and make it yours: setup, widgets, codes and backup.',
      customCss: ['./src/styles/idlescreen.css'],
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/scotty83/idlescreen' },
      ],
      lastUpdated: true,
      sidebar: [
        { label: 'What is idlescreen', slug: 'index' },
        {
          label: 'Getting it on the board',
          items: [
            { label: 'Point your board at idlescreen', slug: 'board/point-your-board' },
            { label: 'The macro (optional)', slug: 'board/the-macro' },
            { label: 'Non-touch devices', slug: 'board/non-touch-devices' },
          ],
        },
        { label: 'Set up your board', slug: 'set-up-your-board' },
        {
          label: 'Using the dashboard',
          items: [
            { label: 'Buttons & navigation', slug: 'using/buttons-and-navigation' },
            { label: 'Edit your layout', slug: 'using/edit-your-layout' },
            { label: 'Settings', slug: 'using/settings' },
            { label: 'Screensavers', slug: 'using/screensavers' },
            { label: 'Display modes', slug: 'using/display-modes' },
          ],
        },
        {
          label: 'Widgets',
          items: [
            { label: 'How widgets work', slug: 'widgets' },
            {
              label: 'Commute', collapsed: true,
              items: [
                { label: 'NYC Subway', slug: 'widgets/commute/subway' },
                { label: 'LIRR & Metro-North', slug: 'widgets/commute/commuter-rail' },
                { label: 'NJ Transit', slug: 'widgets/commute/nj-transit' },
                { label: 'Amtrak', slug: 'widgets/commute/amtrak' },
                { label: 'PATH', slug: 'widgets/commute/path' },
                { label: 'NYC Ferry', slug: 'widgets/commute/nyc-ferry' },
                { label: 'Express Bus', slug: 'widgets/commute/express-bus' },
                { label: 'Citi Bike', slug: 'widgets/commute/citi-bike' },
                { label: 'TfL Status', slug: 'widgets/commute/tfl-status' },
              ],
            },
            {
              label: 'Weather & Air', collapsed: true,
              items: [
                { label: 'Weather', slug: 'widgets/weather-air/weather' },
                { label: 'Air & Sky', slug: 'widgets/weather-air/air-and-sky' },
                { label: 'Surf', slug: 'widgets/weather-air/surf' },
              ],
            },
            {
              label: 'Markets', collapsed: true,
              items: [
                { label: 'Markets', slug: 'widgets/markets/markets' },
                { label: 'Markets News', slug: 'widgets/markets/markets-news' },
              ],
            },
            {
              label: 'Sports', collapsed: true,
              items: [
                { label: 'My Teams', slug: 'widgets/sports/my-teams' },
                { label: 'Sports News', slug: 'widgets/sports/sports-news' },
                { label: 'Formula 1', slug: 'widgets/sports/formula-1' },
                { label: 'Golf (PGA)', slug: 'widgets/sports/golf' },
                { label: 'Tennis', slug: 'widgets/sports/tennis' },
              ],
            },
            {
              label: 'News & Social', collapsed: true,
              items: [
                { label: 'Headlines', slug: 'widgets/news-social/headlines' },
                { label: 'Substack', slug: 'widgets/news-social/substack' },
                { label: 'Bluesky', slug: 'widgets/news-social/bluesky' },
              ],
            },
            {
              label: 'Images', collapsed: true,
              items: [
                { label: 'Art slideshow', slug: 'widgets/images/art' },
                { label: 'Landscapes', slug: 'widgets/images/landscapes' },
                { label: 'iCloud Photos', slug: 'widgets/images/icloud-photos' },
                { label: 'GDrive Photos', slug: 'widgets/images/gdrive-photos' },
                { label: 'NASA Daily Photo', slug: 'widgets/images/nasa-daily-photo' },
                { label: 'Live Video', slug: 'widgets/images/live-video' },
              ],
            },
            {
              label: 'Daily', collapsed: true,
              items: [
                { label: 'This Day in History', slug: 'widgets/daily/this-day-in-history' },
                { label: 'Quote & Word of the Day', slug: 'widgets/daily/quote-and-word' },
                { label: 'Chart of the Day', slug: 'widgets/daily/chart-of-the-day' },
              ],
            },
            {
              label: 'Reference', collapsed: true,
              items: [
                { label: 'World Clock', slug: 'widgets/reference/world-clock' },
                { label: 'Cloud Services', slug: 'widgets/reference/cloud-services' },
              ],
            },
          ],
        },
        {
          label: 'Codes & backup',
          items: [
            { label: 'Setup codes explained', slug: 'codes/setup-codes' },
            { label: 'Back up your board', slug: 'codes/back-up-your-board' },
          ],
        },
        { label: 'FAQ & Troubleshooting', slug: 'faq' },
      ],
    }),
  ],
});
