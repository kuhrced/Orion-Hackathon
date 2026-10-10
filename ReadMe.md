# Race game

A 2D party racing game. The host draws a track on the big screen, up to 6 players join on their
phones with a QR code, and everyone races. The map starts grey and polluted.

## Run it

You need Node.js 20 or newer.

```bash
npm install
```

```bash
npm start
```

Open `http://localhost:3000` on the laptop. This is the big screen.

## Play

1. On the big screen, draw a loop and press **Make track**.
2. Players scan the QR code with their phone camera. The phone must be on the same Wi-Fi as the
   laptop. They type a name and press **Join**.
3. Press **Add bot** if you want computer cars too.
4. Press **Start race**. Cars drive forward by themselves; players steer with the two buttons.
5. After the race, press **Race again** or **New track**.

If a phone cannot open the page, check that it is on the same Wi-Fi, and allow Node.js in the
laptop's firewall when it asks. Some event Wi-Fi blocks phones from reaching laptops; a phone
hotspot fixes that.

## Put it online

The server is one Node.js process and reads its port from the `PORT` variable, so it runs on any
Node host (Render, Railway, Fly.io) with `npm install` and `npm start`. The host must allow
WebSockets. Online, the QR code uses the site's own address.

## Files

| File | What it does |
| --- | --- |
| `server.js` | Serves the pages, keeps the rooms, and moves the cars 60 times a second |
| `shared/track.js` | Turns the drawn line into a track (used by the server and the browser) |
| `public/host.html`, `public/host.js` | The big screen: drawing, lobby, race view, results |
| `public/play.html`, `public/play.js` | The phone: join, close-up view, steering buttons |
| `public/render.js` | Draws the map and the cars |
| `public/cars.png` | Car pictures: 6 colours across, 4 types down, each 128 × 256, pointing up |

## Things to tune

- Speed, steering and lap rules are constants at the top of `server.js`.
- World size and road width are at the top of `shared/track.js`.
- `renderMap(track, scale, green)` in `public/render.js` already takes a `green` value from 0
  (polluted) to 1 (clean). The race uses 0 for now; the quiz will raise it.

## Not built yet

Questions and the map turning green, the Gemini "vibe" and music, the ElevenLabs commentator,
sounds, and the "most correct answers" winner.
