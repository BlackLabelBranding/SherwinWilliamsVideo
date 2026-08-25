import { ImageResponse } from 'next/og';

export const size = { width: 64, height: 64 };
export const contentType = 'image/png';

/** Lightweight circle mark — do not embed the large public/sw-logo.png (OOM on Vercel). */
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '50%',
          background: '#004990',
          color: '#ffffff',
          fontSize: 28,
          fontWeight: 700,
          letterSpacing: '-0.04em',
          fontFamily: 'system-ui, sans-serif'
        }}
      >
        SW
      </div>
    ),
    { ...size }
  );
}
