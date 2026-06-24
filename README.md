# Sherwin-Williams Live Portal

This is a minimal Node.js/Express web application providing a live streaming portal for Sherwin-Williams drivers. 
It allows drivers to log in, watch a live HLS stream, post comments during the live broadcast, and later view the recording in the archive.

## Features

- Simple login system with hard-coded users (for demonstration; replace with a real authentication mechanism in production).
- Live HLS video player placeholder (replace the video URL in `public/js/app.js` with your Amazon IVS stream URL).
- Comment system with in-memory storage (for demonstration; replace with a persistent database in production).
- Basic styling using Sherwin-Williams brand colors.

## Running the App

1. Ensure you have [Node.js](https://nodejs.org) installed on your system.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the server:
   ```bash
   npm start
   ```
4. Open your browser at `http://localhost:3000`.

## Notes

- The application uses a minimal in-memory comment store and hard-coded user credentials. For production, integrate with a database and a secure authentication system (e.g., Amazon Cognito).
- Replace the HLS stream URL in `public/js/app.js` (`video.src`) with your actual Amazon IVS playback URL.
- Add additional pages (e.g., archive) as needed. A placeholder is provided in `public/js/archive.js`.