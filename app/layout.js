import Script from 'next/script';
import PwaRegistration from '@/components/PwaRegistration';
import './globals.css';

export const metadata = {
  title: 'Sherwin Safety',
  description: 'Sherwin-Williams safety video portal',
  applicationName: 'Sherwin Safety',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' }
    ],
    apple: [{ url: '/sherwin-safety-icon-180.png', sizes: '180x180', type: 'image/png' }]
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Sherwin Safety'
  }
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#004990',
  interactiveWidget: 'resizes-content'
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body cz-shortcut-listen="true">
        {children}
        <PwaRegistration />
        <Script src="https://player.live-video.net/1.53.0/amazon-ivs-player.min.js" strategy="beforeInteractive" />
        <Script src="https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js" strategy="beforeInteractive" />
      </body>
    </html>
  );
}
