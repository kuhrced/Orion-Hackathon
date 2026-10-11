# Know & Go

A 2D racing quiz game for a class or a party. The host draws a track on the big screen, up to 6
players join on their phones with a QR code, and everyone races. Every 10 to 20 seconds the race
stops for a question. Gemini writes the questions for any topic, or from a PDF the teacher
uploads. A fast right answer earns up to 1000 points and a speed boost. The first car home wins
the race, but the real winner is the player with the most right answers.

## Run it

You need Node.js 20.12 or newer, and a Gemini API key for the questions (see "Questions" below:
without a key there are no questions until someone adds them on the teacher screen).

```bash
npm install
```

```bash
npm start
```

Open `http://localhost:3000` on the laptop for the front page, then press the **Host** button to
open the big screen (`/host`). The server prints one line for every device that opens a page or
joins, which helps when a phone "cannot get in".

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
   answer on their phone. A right answer gives a speed boost and points: the faster, the more
   (up to 1000). The big screen and the phones show the top 3.
7. After the race, press **Race again** or **New track**.

A lap takes 30 to 50 seconds of driving. One lap is the default, so a race with its questions is
about a minute and a half; the host can change it before the start. The host can press
**End race** at any time to go straight to the results.
A short race asks questions more often, so every race has a few.

If a phone cannot open the page, check that it is on the same Wi-Fi, and allow Node.js in the
laptop's firewall when it asks. Some event Wi-Fi blocks phones from reaching laptops (guest
networks often do); a phone hotspot, or putting the game online, fixes that.

## Questions

The host picks one of two modes before the race, with the **Mode** buttons:

- **Team** (the default): everyone gets the same question, shown big on the screen with its four
  answers. The level follows the group: up when most players are right, down when most are wrong.
- **Solo**: every player gets their own question, at their own level: easy, medium or hard. A
  right answer moves a player up a level and a wrong one moves them down. Subtopics a player
  gets wrong come back later.

Harder questions give a longer boost.

### Gemini writes the questions

Copy `.env.example` to `.env` and put a Gemini API key in it (get one at
https://aistudio.google.com/apikey). Git ignores `.env`; never put the key anywhere else.

```bash
npm run try-gemini
```

With a key, Gemini writes a fresh set of 30 questions in three levels for the topic the host types
in ("Random" by default: general knowledge), and a personal note for each player after the race.

The host can also press **Upload a PDF** (up to 12 MB). Gemini reads it and writes the questions
from what the document says. **Start race** waits until Gemini has finished, so the questions
the host asked for are the ones that get played.

### Teacher screen

Press **Teacher screen** on the big screen to open a second page, `/teacher`. It shows Gemini
working, every question with its right answer, and how each player is doing during the race.
The teacher can change or remove any question and press **Add question** to write their own
(not while a race is running). It needs the host's key, so players cannot open it.

### No built-in questions

Every question is written by Gemini or added on the teacher screen. Without questions a race
cannot start. As a last resort (Gemini is down on the day), start the server with
`BUILTIN_QUESTIONS=1 npm start`: it loads the old set of 100 from `data/questions.json`.

## Voice

In Team mode a voice on the big screen reads each question out when it appears, and the right
answer when time is up. It says nothing else. The **Voice: on/off** button turns it off.

Without a key the browser's own voice is used. To get an ElevenLabs voice, add
`ELEVENLABS_API_KEY=` and your key to `.env` and restart.

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
code uses the site's own address, so phones on any Wi-Fi or on mobile data can join.

### On a Vultr server

1. In Vultr, deploy a small **Shared CPU** instance with **Ubuntu 24.04** and a public IPv4
   address, in the city nearest to you.
2. Log in to it as root and run the set-up script. It installs Node.js, fetches the game, keeps
   it running as a service on port 80 and opens the firewall for it:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/kuhrced/Orion-Hackathon/clark-fixes-on-0.05/deploy/setup.sh | bash
   ```

   (The same line also works as the instance's Cloud-Init user data, after a first line `#!/bin/bash`.)
3. Copy your keys to the server. Run this on your own computer, in the project folder, with the
   server's address in place of `SERVER`:

   ```bash
   ssh root@SERVER 'cat > /opt/know-and-go/.env && chmod 600 /opt/know-and-go/.env && systemctl restart know-and-go' < .env
   ```

4. Open `http://SERVER/host` for the big screen. Run the set-up script again to update the game.

## Files

| File | What it does |
| --- | --- |
| `server.js` | Serves the pages, keeps the rooms, moves the cars and asks the questions |
| `shared/track.js` | Turns the drawn line into a track (used by the server and the browser) |
| `public/index.html`, `public/landing.css`, `public/landing.js` | The front page at `/`: host a race, or join with a code |
| `public/cars/` | The four cars that drive across the landing page |
| `shared/cars.json` | Car stats from `docs/car-stats.pdf`: top speed, acceleration, handling and weight for each car type |
| `shared/props.js` | The cones, tyres, crates, barrels and dummies on the road: what they are and where they start |
| `shared/cars.js` | Turns those stats into what the race uses, and says which row of `cars.png` is which car type |
| `public/host.html`, `public/host.js` | The big screen at `/host`: drawing, lobby, race view, questions, results |
| `public/play.html`, `public/play.js` | The phone: join, close-up view, steering buttons, answers |
| `public/worlds.js` | The five worlds: how each one looks, and everything that moves on the map |
| `public/render.js` | Draws the cars and what they leave behind, and keeps the map picture ready |
| `public/cars.png` | Car pictures: 6 colours across, 4 types down, each 128 × 256, pointing up |
| `public/teacher.html`, `public/teacher.js`, `public/teacher.css` | The teacher screen: Gemini's questions with answers, and the players' progress |
| `gemini.js` | Asks Gemini for questions (from a topic or a PDF) and for the personal notes |
| `voice.js` | The ElevenLabs voice that reads the question and the answer |
| `public/commentator.js` | Plays that voice on the big screen |
| `memory.js` | What the game remembers about each player (a file, and Backboard with a key) |
| `data/questions.json` | 100 spare questions, only loaded with `BUILTIN_QUESTIONS=1` |
| `ignore/` | Old copies kept by the team; the game does not use this folder |
| `deploy/setup.sh` | Sets the game up on a fresh Ubuntu server (used for Vultr) |
| `CLAUDE.md` | Project notes that Claude reads when a teammate works on this repo |

## Things to tune

All of these are constants at the top of `server.js`:

- Car speed and steering.
- How often a question comes, how long players have to answer, and how strong the boost is.
- `DEFAULT_TOPIC`: the topic a new game starts with.

World size and road width are at the top of `shared/track.js`. How much each car stat changes
the driving is in `shared/cars.js`; the stats themselves are in `shared/cars.json`.

## Not built yet

Music and sound effects.
figuring out who "json" is and why he sent me packages
