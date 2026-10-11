# QR Racer

QR Racer is a multiplayer racing quiz game. A teacher hosts a race on a large screen, and
players join from their phones using a room code or QR link. Questions pause the race; correct
answers earn points and a temporary speed boost.

The game does not change an environment or map health. Race progress is based on driving,
answers, and points.

## Run locally

Requires Node.js 20 or newer.

```bash
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000), then choose **Host a race**.

To use Gemini, copy `.env.example` to `.env` and add a key:

```bash
GEMINI_API_KEY=your-key
```

The server also supports:

- `PORT`: server port; defaults to `3000`.
- `PUBLIC_URL`: public base URL used for QR codes and join links.
- `ELEVENLABS_API_KEY`: optional hosted voice generation.
- `ELEVENLABS_VOICE_ID` and `ELEVENLABS_MODEL`: optional ElevenLabs settings.
- `BACKBOARD_API_KEY`: optional player-memory storage.
- `GEMINI_WAIT_MS` and `GEMINI_WAIT_PDF_MS`: question-generation wait limits.

Never commit `.env` or API keys. Use `npm run try-gemini` to test Gemini separately.

## How to play

1. On the host screen, draw a track and choose the number of laps.
2. Select a topic, or leave the default topic as **Random**.
3. Share the displayed direct join link or scan the QR code. The link includes the room code,
   for example `http://192.168.1.20:3000/play?room=FKYG`.
4. Players choose a name and car on their phones.
5. The host can add computer players, edit questions, and start the race.
6. Players steer their cars and answer questions when the race pauses.

The host screen shows the top three players by points. A correct answer can award up to 1,000
points; the longer a player takes to answer, the fewer points they receive. The same ranking is
also available on player screens.

## Race modes

### Solo mode

Each player receives an individual question selected for their current difficulty level. Correct
answers raise their level, incorrect answers lower it, and missed subtopics can return later.

### Team mode

Everyone receives the same question at the same time. The question and all available answers are
shown to the team. The group difficulty changes based on the team's results, but the question is
not dynamically changed per player.

In team mode, the large screen can read the question and answer aloud. Without ElevenLabs, the
browser's built-in speech synthesis is used.

## Questions

Questions come from one of two sources:

- Gemini-generated questions based on the topic or an uploaded PDF.
- Questions manually added or edited on the teacher screen.

There is no active built-in question fallback. If Gemini is unavailable, the teacher must add
questions manually before starting the race. The teacher screen lets the host:

- Add a question through the add-question dialog.
- Edit the question, answer choices, correct answer, difficulty, and subtopic.
- Remove questions.
- See the correct answers and player progress.

New questions are inserted at the top of the question list.

### AI safety and limits

Gemini requests are rate-limited by the server. Generated question content is checked for
unsafe or inappropriate material, and prompts that contain sensitive topics receive a warning
asking the host to retry with a safer topic. Generated question text is also checked before it
is used in a race.

The default policy allows up to three question-generation requests and twelve feedback requests
per ten-minute window. These limits help prevent accidental request loops and excessive API use.

## Player memory

The game can remember a player's previous topic performance, correct answers, and weak subtopics.
Local memory is stored in `data/memory.json`, which is ignored by Git. Backboard storage is
optional and requires `BACKBOARD_API_KEY`.

## Project structure

```text
server.js
  HTTP/static serving, WebSocket routing, room orchestration, and race loop

server/
  question-bank.js       Question-bank data structures and lookup helpers
  question-service.js     Gemini generation, caching, retries, and bank preparation
  question-lifecycle.js  Question timing, answers, scoring, team mode, and voice prompts
  room-state.js           State, leaderboard, snapshot, and prop messages
  race-physics.js         Car movement, respawning, collisions, and prop physics

shared/
  track.js               Track generation and shared world geometry
  cars.js, cars.json     Car definitions and tuning
  props.js               Road-object definitions

public/
  index.html/js/css      Landing page and room-code entry
  host.html/js            Host screen, QR link, race controls, and leaderboard
  play.html/js            Player join, car selection, steering, and answers
  teacher.html/js/css     Question editor and player progress screen
  render.js               Race rendering
  commentator.js          Browser voice playback

gemini.js                Gemini API integration and question/feedback prompts
ai-policy.js             AI rate limits and content-safety checks
voice.js                 Optional ElevenLabs voice generation
memory.js                Local and optional Backboard player memory
```

## Useful commands

```bash
npm start
npm run try-gemini
npm run export-questions
```

The server needs WebSocket support and must be reachable by phones on the same network. If
phones cannot open the join link, check the laptop firewall and Wi-Fi client isolation settings.
