# QR Racer

A local multiplayer racing game. The landing page lets you host a race on the big screen or join one from a phone. The host draws the track, players choose cars, and the race runs over WebSockets.

## Run it

Requires Node.js 20 or newer.

```powershell
npm install
npm start
```

Open `http://localhost:8000` for the QR Racer landing page.

- `/host` opens the big-screen host view.
- `/play` opens the phone player view.
- The host screen generates a QR code and room code for players.

## Project layout

| File | Purpose |
| --- | --- |
| `public/index.html`, `public/landing.js`, `public/landing.css` | QR Racer landing page |
| `server.js` | HTTP/WebSocket server and race simulation |
| `public/host.html`, `public/host.js` | Big-screen host view |
| `public/play.html`, `public/play.js` | Phone join and steering view |
| `public/render.js` | Track and car rendering |
| `shared/track.js` | Shared track generation and validation |
| `public/cars.png` | Race car sprite sheet |
| `public/cars/` | Cars used by the landing page |

`questions.db` is preserved in the folder but is intentionally not read or modified by the racing app.
