# Race game (CodeRED Orion hackathon)

A 2D party racing game with an environment theme. The host draws a track on the big screen, up
to 6 players join on their phones with a QR code, and everyone races. Every 20 seconds the race
stops for a question. Right answers give a speed boost and turn the shared map from polluted to
green. The first car home wins the race, but the real winner is whoever answered the most
questions right.

## Run and test

- `npm install`, then `npm start`. `http://localhost:3000` is the landing page, `/host` is the big
  screen, and phones join at `/play`.
- There is no test suite. To check a change, play a race: draw a loop, press **Make track**,
  **Add bot**, **Start race**. Bots drive and answer questions, so one person can test alone.
- Restart the server after changing `server.js` or anything in `shared/`. Files in `public/` only
  need a browser reload.

## How it fits together

- `server.js` owns the game. It moves the cars 60 times a second, asks the questions, and sends
  snapshots 30 times a second. Browsers never move cars; they only draw what the server sends.
- `shared/track.js` turns the drawn line into a track. The server and the browser both import it,
  so it must stay free of Node-only and browser-only code.
- `public/render.js` draws the map. `createScene(track)` decides where everything goes, using the
  track's seed so every screen gets the same map. `paintScene(ctx, scene, green, region)` draws
  it, where `green` runs from 0 (polluted) to 1 (clean). That picture is still and is cached.
  `createLife(scene)` draws what moves on top of it every frame (smoke, river, birds, smog), and
  `createEffects()` draws what the cars leave behind (exhaust, dust, skid marks, confetti).
- `shared/cars.json` holds the team's car stats (1 to 5 each). `shared/cars.js` turns them into
  physics numbers and maps the rows of `public/cars.png` to car types. The effects are kept
  small so every car can win; re-check the balance after changing them.
- `public/host.js` is the big screen. `public/play.js` is the phone.
- `questions.db` holds the questions. `data/questions.json` is a copy for Node versions
  without built-in SQLite; run `npm run export-questions` after changing the database.

Game phases, in order: `draw`, `lobby`, `countdown`, `race`, then `question` and `reveal` every
20 seconds of driving, and finally `results`.

## Rules for changes

- Keep the server in charge. Do not add game logic that only runs in the browser.
- Scenery must come from the seeded random generator in a fixed order. `Math.random()` in
  `createScene` would give each screen a different map.
- Phones are the weak devices. They draw the map as tiles; do not draw the whole world on a phone.
- No frameworks and no build step. Plain JavaScript modules, plus `ws` and `qrcode` on the server.
- API keys (Gemini, ElevenLabs) go in a local `.env` file, which Git ignores. The repository is
  public, so never commit a key.
- Work on a branch and open a pull request. Do not push straight to `main`.

## People

Some teammates are still learning English. Write explanations in short, simple sentences, and
give a short recap of what you understood before starting a big change.

## Not built yet

The Gemini "vibe" and music, the ElevenLabs commentator, sound effects, and putting the server
online.
