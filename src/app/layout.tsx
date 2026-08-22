import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ZBT Kitchen Duty',
  description: 'Kitchen duty schedule for the ZBT chapter house',
  // The schedule is public so it is as easy to check as the screenshot it
  // replaces, but 95 real names should not become search results.
  robots: { index: false, follow: false, nocache: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Brothers check this on their phones; match the chrome to the app.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f2f4f9' },
    { media: '(prefers-color-scheme: dark)', color: '#0b1526' },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Domine:wght@500;600;700&family=Public+Sans:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
