import type { Metadata, Viewport } from 'next';
import { KitchenTheme } from './kitchen-theme.tsx';

export const metadata: Metadata = {
  title: 'Kitchen Late Plates — ZBT',
  robots: { index: false, follow: false, nocache: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#f2f4f9',
  colorScheme: 'light',
};

export default function KitchenLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div data-theme="light" style={{ minHeight: '100vh', colorScheme: 'light' }}>
      <KitchenTheme />
      {children}
    </div>
  );
}
