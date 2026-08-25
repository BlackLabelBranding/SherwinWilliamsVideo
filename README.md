# Sherwin-Williams Live Portal (Next.js)

Driver portal for Amazon IVS live streams and S3 archive playback.

## Important

AWS secrets (S3 / IVS / Cognito) stay on the **server** in Next.js API routes. They are not exposed in the browser. The UI is React; the same APIs (`/api/auth`, `/api/content`, `/api/admin`, `/api/hls`, `/api/metrics`) power the app.

## Setup

1. Copy `.env.example` to `.env` and fill AWS / auth values.
2. Install and run:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Production:

```bash
npm run build
npm start
```

## Auth

- `AUTH_MODE=both` (default): Cognito first when configured, then static users


## Features

- Auto-detect live IVS streams
- Archive HLS via private S3 + presigned segments
- Admin: users, trim playlists, live stream picker
- Comments + basic viewing metrics
