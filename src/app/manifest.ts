import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'ZBT Kitchen Portal',
    short_name: 'Kitchen Portal',
    description: 'Kitchen Portal for Brothers — shifts, late plates, and menus',
    start_url: '/late-plate',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#0f172a',
    icons: [
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
      },
    ],
  };
}
