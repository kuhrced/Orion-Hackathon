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
2. Players scan the QR code with their phone camera. That is all: the phone joins the game
   straight away, with a made-up name. The phone must be on the same Wi-Fi as the laptop.
   (If a camera will not scan, open the address under the game code and type the code.)
3. On the phone, players can change their name and press **Change car**. Each car type drives
   differently, and the phone shows its stats.
4. Press **Add bot** if you want computer cars too. Bots also answer questions.
5. Press **Start race**. Cars drive forward by themselves; players steer with the two buttons.
   Cones, tyres, crates, barrels and crash-test dummies stand on the road. Hitting them sends
   them flying and tumbling; crates smash and dummies lose parts. The car keeps its speed.
6. Before each question there is a 3-second "get ready" countdown. Then everyone picks an
   answer on their phone. A right answer gives a
   speed boost, and every right answer makes the shared map greener.
7. After the race, press **Race again** or **New track**.

A lap takes 30 to 50 seconds of driving. One lap is the default, so a race with its questions is
about a minute and a half; the host can change it before the start. The host can press
**End race** at any time to go straight to the results.
A short race asks questions more often, so the map can always become fully clean.

If a phone cannot open the page, check that it is on the same Wi-Fi, and allow Node.js in the
laptop's firewall when it asks. Some event Wi-Fi blocks phones from reaching laptops; a phone
hotspot fixes that.

## Questions

The host picks one of two modes before the race, with **Questions > Change**:

- **Personal** (the default): every player gets their own question, at their own level: easy,
  medium or hard. A right answer moves a player up a level and a wrong one moves them down.
  Subtopics a player gets wrong come back later.
- **Class**: everyone gets the same question, shown big on the screen with its four answers.
  The level follows the class: up when most players are right, down when most are wrong.

Harder questions give a longer boost and clean more of the map.

### Gemini writes the questions

Copy `.env.example` to `.env` and put a Gemini API key in it (get one at
https://aistudio.google.com/apikey). Git ignores `.env`; never put the key anywhere else.

```bash
npm run try-gemini
```

With a key, Gemini writes a fresh set of questions in three levels for the topic the host types in
(the environment by default), and a personal note for each player after the race.

The host can also press **Upload a PDF** (up to 12 MB). Gemini reads it and writes the questions
from what the document says. **Start race** waits until Gemini has finished, so the questions
the host asked for are the ones that get played.

### Teacher screen

Press **Teacher screen** on the big screen to open a second page, `/teacher`. It shows Gemini
working, every question with its right answer, and how each player is doing during the race.
It needs the host's key, so players cannot open it.

### Backup questions

Without a key, or if Gemini cannot be reached, the game uses the built-in questions below.

The 100 built-in questions are in `data/questions.json`, each with a level and a subtopic. They
were exported from `questions.db`. After changing the database, refresh the copy (this needs
Node.js 22.13 or newer); levels and subtopics already set are kept:

```bash
npm run export-questions
```

## Commentator

A commentator talks about the race on the big screen: the start, a new leader, questions, right
answers, crashes, the last lap, the finish and the real winner. The words also show at the
bottom of the map. The **Voice: on/off** button on the big screen turns the sound off.

Without a key the browser's own voice is used. To get an ElevenLabs voice, add
`ELEVENLABS_API_KEY=` and your key to `.env` and restart. A race is about 600 letters of speech.

## Player memory

The game remembers each player between races: the topic, how many answers were right, the
subtopics they got wrong and the level they reached. A returning player starts on their own
level, their weak subtopics come back first, and the phone says "Welcome back". A player is
known by a random id that their phone keeps; there are no accounts.

The memory is kept in `data/memory.json` (Git ignores it). With `BACKBOARD_API_KEY=` and a key
from https://app.backboard.io in `.env`, every race is also saved as a memory in Backboard, so it
is still there when the game runs on another computer.

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
| `shared/props.js` | The cones, tyres, crates, barrels and dummies on the road: what they are and where they start |
| `shared/cars.js` | Turns those stats into what the race uses, and says which row of `cars.png` is which car type |
| `public/host.html`, `public/host.js` | The big screen at `/host`: drawing, lobby, race view, questions, results |
| `public/play.html`, `public/play.js` | The phone: join, close-up view, steering buttons, answers |
| `public/worlds.js` | The five worlds: how each one looks polluted and clean, and everything that moves on the map |
| `public/render.js` | Draws the cars and what they leave behind, and keeps the map picture ready |
| `public/cars.png` | Car pictures: 6 colours across, 4 types down, each 128 × 256, pointing up |
| `public/teacher.html`, `public/teacher.js`, `public/teacher.css` | The teacher screen: Gemini's questions with answers, and the players' progress |
| `gemini.js` | Asks Gemini for questions (from a topic or a PDF) and for the personal notes |
| `commentary.js`, `voice.js` | What the commentator says, and the ElevenLabs voice that says it |
| `public/commentator.js` | Plays the commentator on the big screen and shows the words |
| `memory.js` | What the game remembers about each player (a file, and Backboard with a key) |
| `data/questions.json` | The built-in backup questions, with a level and a subtopic each |
| `questions.db` | Where the backup questions were first written |
| `CLAUDE.md` | Project notes that Claude reads when a teammate works on this repo |

## Things to tune

All of these are constants at the top of `server.js`:

- Car speed and steering.
- How often a question comes, how long players have to answer, and how strong the boost is.
- `GREEN_TARGET`: the share of right answers that makes the map fully green by the end.

World size and road width are at the top of `shared/track.js`. How much each car stat changes
the driving is in `shared/cars.js`; the stats themselves are in `shared/cars.json`.

## Not built yet

Music, sound effects, and putting the server online.
figuring out who "json" is and why he sent me packages
