import Script from 'next/script';
import './globals.css';

export const metadata = {
  title: 'Sherwin-Williams Live',
  description: 'Driver live streaming and archive portal',
  applicationName: 'Sherwin-Williams Live'
};

export const viewport = {
  themeColor: '#004990'
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Script src="https://player.live-video.net/1.53.0/amazon-ivs-player.min.js" strategy="afterInteractive" />
        <Script src="https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js" strategy="afterInteractive" />
      </body>
    </html>
  );
}
