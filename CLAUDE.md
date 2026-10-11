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
- `public/worlds.js` is the map. There are five worlds (forest, ocean, swamp, desert, ice); the
  server picks one per track and the host can change it in the lobby. Each world is a recipe in
  `WORLDS` at the bottom of the file: colours as `[polluted, clean]` pairs, plus lists of plants,
  polluting machines, rubbish and strange landmarks. To add a world, add a recipe there and its
  id to `WORLD_IDS` in `shared/track.js`.
- In that file, `createScene(track)` decides where everything goes, using the track's seed so
  every screen gets the same map. `paintScene(ctx, scene, green, region)` draws the still
  picture, where `green` runs from 0 (polluted) to 1 (clean). `createLife(scene)` draws what
  moves on top of it every frame (smoke, flames, waves, birds, whales, northern lights).
- `public/render.js` has the cars, the cached map (one picture on the big screen, tiles on
  phones) and `createEffects()`: what the cars leave behind (exhaust, dust, skid marks).
- `shared/cars.json` holds the team's car stats (1 to 5 each). `shared/cars.js` turns them into
  physics numbers and maps the rows of `public/cars.png` to car types. The effects are kept
  small so every car can win; re-check the balance after changing them.
- `shared/props.js` lists the things standing on the road (cones, tyres, crates, barrels,
  crash-test dummies) and where they start. The server moves them with real physics in
  `stepProps`, including height, and sends only the ones that are moving. When something breaks
  the server sends a `break` message and each screen throws its own pieces. A dummy is a rag
  doll: the server moves the body, and each screen makes the limbs flop (`flopDoll` in
  `public/render.js`).
- `public/host.js` is the big screen. `public/play.js` is the phone.
- Questions are personal: each player has a level (1 easy, 2 medium, 3 hard) and gets their own
  question each time. `gemini.js` asks Gemini to write a bank of questions for the room's topic;
  `prepareBank` in `server.js` falls back to `data/questions.json` when there is no key or the
  call fails. Everything Gemini returns is checked before it is used. Never call Gemini in the
  middle of a race: banks are written in the lobby and reused.
- The host can upload a PDF instead of typing a topic (`POST /pdf`, with the room and host key in
  headers). `public/teacher.js` is a second screen for the host only: it connects with
  `{ t: 'watch', code, key }` and is the only screen that is sent the right answers early.
- Screens look after their own connection (`connect` in `public/render.js`): the server sends a
  heartbeat, and a screen that hears nothing for 5 seconds reconnects and shows a banner.
  Car positions are blended on the server's race clock, not on arrival time, so bunched-up
  Wi-Fi packets do not make the cars stutter.

Game phases, in order: `draw`, `lobby`, `countdown`, `race`, then `question-countdown`,
`question` and `reveal` every 10 to 20 seconds of driving, and finally `results`.

## Rules for changes

- Keep the server in charge. Do not add game logic that only runs in the browser.
- Scenery must come from the seeded random generator in a fixed order. `Math.random()` in
  `createScene` would give each screen a different map.
- Phones are the weak devices. They draw the map as tiles; do not draw the whole world on a phone.
  Anything new in `createLife` must skip things outside `region`, and small decorations must
  respect `lite`, which a slow phone turns on by itself.
- No frameworks and no build step. Plain JavaScript modules, plus `ws` and `qrcode` on the server.
- API keys (Gemini, ElevenLabs) go in a local `.env` file, which Git ignores. The repository is
  public, so never commit a key.
- Work on a branch and open a pull request. Do not push straight to `main`.

## People

Some teammates are still learning English. Write explanations in short, simple sentences, and
give a short recap of what you understood before starting a big change.

## Not built yet

Music, the ElevenLabs commentator, sound effects, and putting the server online.
