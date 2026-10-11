// Turns the commentator's lines into speech with ElevenLabs. Optional, like Gemini: without a
// key, or when a call fails, the big screen reads the line out with the browser's own voice.
//
// The key comes from ELEVENLABS_API_KEY in the .env file. It is never logged or sent to a browser.
import crypto from 'node:crypto';

const BASE = () => process.env.ELEVENLABS_URL || 'https://api.elevenlabs.io';
// "George", one of the ready-made voices that every account can use.
const VOICE = () => process.env.ELEVENLABS_VOICE_ID || 'JBFqnCBsd6RMkjVDRZzb';
// The fast model: a line is ready in about half a second, and it costs half as much.
const MODEL = () => process.env.ELEVENLABS_MODEL || 'eleven_flash_v2_5';
const KEEP = 60; // sound clips kept in memory

export const voiceReady = () => !!process.env.ELEVENLABS_API_KEY;

const clips = new Map(); // id -> the sound, as MP3
const known = new Map(); // a line that was spoken before -> its id, so the same words are not paid for twice
const making = new Map(); // a line that is being made right now -> the request, shared by everyone who wants it
let failures = 0;
let pausedUntil = 0;

export const clip = (id) => clips.get(id) ?? null;

// Makes a sound clip of `text` and returns its id, or null if it could not be made.
export function speak(text) {
  if (!voiceReady() || Date.now() < pausedUntil) return Promise.resolve(null);
  if (clips.has(known.get(text))) return Promise.resolve(known.get(text));
  if (!making.has(text)) making.set(text, make(text).finally(() => making.delete(text)));
  return making.get(text);
}

async function make(text) {
  const post = (body) => fetch(`${BASE()}/v1/text-to-speech/${VOICE()}?output_format=mp3_44100_64`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'xi-api-key': process.env.ELEVENLABS_API_KEY },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(3000), // a late line is worse than no line: after this the screen gets the words alone
  });
  try {
    // Lively, and a little faster than normal speech: this is a race.
    let response = await post({ text, model_id: MODEL(), voice_settings: { stability: 0.35, similarity_boost: 0.75, speed: 1.1 } });
    // An account that does not have this model or these settings: ask again with the defaults.
    if (response.status === 400 || response.status === 422) response = await post({ text });
    if (!response.ok) throw new Error(`ElevenLabs answered ${response.status}: ${(await response.text()).slice(0, 160)}`);
    const id = crypto.randomBytes(9).toString('base64url');
    clips.set(id, Buffer.from(await response.arrayBuffer()));
    known.set(text, id);
    for (const [line, old] of known) {
      if (clips.size <= KEEP) break;
      clips.delete(old);
      known.delete(line);
    }
    failures = 0;
    return id;
  } catch (error) {
    console.log(`ElevenLabs could not speak: ${error.message}`);
    // Three failures in a row (a wrong key, no credits left): stop asking for a minute.
    if (++failures >= 3) {
      failures = 0;
      pausedUntil = Date.now() + 60000;
    }
    return null;
  }
}
