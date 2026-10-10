# QR Racer

A 2D party racing game with an environment theme. The host draws a track on the big screen, up
to 6 players join on their phones with a QR code, and everyone races. The map starts grey and
polluted. Every 20 seconds the race stops for a question. Right answers give a speed boost and
heal the map. The first car home wins the race, but the real winner is the player with
the most right answers.

## Run it

You need Node.js 20 or newer.

```bash
npm install
```

```bash
npm start
```

Open `http://localhost:3000` on the laptop for the landing page, then press **Host a race** to open
the big screen (`/host`).

## Play

1. On the big screen, draw a loop and press **Make track**. The game adds bends and scenery, and
   picks one of five worlds: forest, ocean, swamp, desert or ice. Press **Change** to try another.
2. Players scan the QR code with their phone camera. The phone must be on the same Wi-Fi as the
   laptop. They type a name and press **Join**.
3. Players can press **Change car** on their phone. Each car type drives differently, and the
   phone shows its stats.
4. Press **Add bot** if you want computer cars too. Bots also answer questions.
5. Press **Start race**. Cars drive forward by themselves; players steer with the two buttons.
   Cones, tyres, crates and barrels stand on the road. Hitting them slows a car a little and
   sends them flying; crates smash.
6. When a question appears, everyone picks an answer on their phone. A right answer gives a
   speed boost, and every right answer makes the shared map greener.
7. After the race, press **Race again** or **New track**.

A lap takes about one minute. Two laps is the default; the host can change it before the start.

If a phone cannot open the page, check that it is on the same Wi-Fi, and allow Node.js in the
laptop's firewall when it asks. Some event Wi-Fi blocks phones from reaching laptops; a phone
hotspot fixes that.

## Questions

The questions live in `questions.db` (SQLite). The server only reads this file. Each game
remembers which questions it has used, so they do not repeat until all have been asked.

`data/questions.json` is a copy for Node versions without built-in SQLite. After changing the
database, refresh the copy (this needs Node.js 22.13 or newer):

```bash
npm run export-questions
```

## Put it online

The server is one Node.js process and reads its port from the `PORT` variable, so it runs on any
Node host with `npm install` and `npm start`. The host must allow WebSockets. Online, the QR
code uses the site's own address.

## Files

| File | What it does |
| --- | --- |
| `server.js` | Serves the pages, keeps the rooms, moves the cars and asks the questions |
| `shared/track.js` | Turns the drawn line into a track (used by the server and the browser) |
| `public/index.html`, `public/landing.css`, `public/landing.js` | The landing page at `/`: Host a race, or join with a code |
| `public/cars/` | The four cars that drive across the landing page |
| `shared/cars.json` | Car stats from `docs/car-stats.pdf`: top speed, acceleration, handling and weight for each car type |
| `shared/props.js` | The cones, tyres, crates and barrels on the road: what they are and where they start |
| `shared/cars.js` | Turns those stats into what the race uses, and says which row of `cars.png` is which car type |
| `public/host.html`, `public/host.js` | The big screen at `/host`: drawing, lobby, race view, questions, results |
| `public/play.html`, `public/play.js` | The phone: join, close-up view, steering buttons, answers |
| `public/worlds.js` | The five worlds: how each one looks polluted and clean, and everything that moves on the map |
| `public/render.js` | Draws the cars and what they leave behind, and keeps the map picture ready |
| `public/cars.png` | Car pictures: 6 colours across, 4 types down, each 128 × 256, pointing up |
| `questions.db` | The questions |
| `data/questions.json` | A copy of the questions for Node versions without built-in SQLite |
| `CLAUDE.md` | Project notes that Claude reads when a teammate works on this repo |

## Things to tune

All of these are constants at the top of `server.js`:

- Car speed and steering.
- How often a question comes, how long players have to answer, and how strong the boost is.
- `GREEN_TARGET`: the share of right answers that makes the map fully green by the end.

World size and road width are at the top of `shared/track.js`. How much each car stat changes
the driving is in `shared/cars.js`; the stats themselves are in `shared/cars.json`.

## Not built yet

The Gemini "vibe" and music, the ElevenLabs commentator, sound effects, and putting the server
online.
