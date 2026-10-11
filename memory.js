// What the game remembers about each player between races: the topics they played, how many
// answers they got right, which subtopics they are weak on and which level they reached. The
// next race uses it: a returning player starts on their own level, and their weak subtopics
// come back first.
//
// Every race adds one small record per player. The records are always kept in
// data/memory.json on this computer. With BACKBOARD_API_KEY in the .env file they are also
// kept as memories in Backboard (backboard.io), so they survive when the game moves to another
// computer or goes online. Like Gemini, this is optional: if Backboard cannot be reached, the
// game carries on with the file.
//
// A player is known by a random id that their phone makes up and keeps. No account, no email.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// MEMORY_FILE lets a test keep its pretend players away from the real ones.
const FILE = () => process.env.MEMORY_FILE || path.join(path.dirname(fileURLToPath(import.meta.url)), 'data', 'memory.json');
const BASE = () => process.env.BACKBOARD_URL || 'https://app.backboard.io/api';
const ASSISTANT_NAME = 'QR Racer coach';
const KEEP = 30; // records kept for each player

export const backboardReady = () => !!process.env.BACKBOARD_API_KEY;

const records = new Map(); // player's id -> their records, oldest first
let assistantId = null;

function keep(record) {
  if (!record || typeof record.student !== 'string' || typeof record.topic !== 'string' || !Number.isFinite(record.at)) return false;
  const list = records.get(record.student) ?? [];
  if (list.some((old) => old.at === record.at && old.topic === record.topic)) return false; // already known
  list.push(record);
  list.sort((a, b) => a.at - b.at);
  records.set(record.student, list.slice(-KEEP));
  return true;
}

// Saves run one after another. A race ends with one record per player, and several writes to
// the same file at the same moment can land on top of each other and leave it unreadable.
let saving = Promise.resolve();
function saveFile() {
  saving = saving
    .then(() => fs.promises.writeFile(FILE(), JSON.stringify([...records.values()].flat())))
    .catch((error) => console.log(`The player memory could not be saved: ${error.message}`));
}

async function backboard(method, route, body) {
  const response = await fetch(`${BASE()}${route}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-API-Key': process.env.BACKBOARD_API_KEY },
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Backboard answered ${response.status}: ${(await response.text()).slice(0, 160)}`);
  return response.status === 204 ? null : response.json();
}

// One "assistant" in Backboard holds all the memories of this game. It is found by name, or
// made the first time.
async function findAssistant() {
  if (process.env.BACKBOARD_ASSISTANT_ID) return process.env.BACKBOARD_ASSISTANT_ID;
  const answer = await backboard('GET', '/assistants');
  const list = Array.isArray(answer) ? answer : answer?.assistants ?? answer?.items ?? [];
  const found = list.find((assistant) => assistant.name === ASSISTANT_NAME);
  if (found) return found.assistant_id ?? found.id;
  const made = await backboard('POST', '/assistants', {
    name: ASSISTANT_NAME,
    system_prompt: 'You are a coach for students who play a quiz racing game. Your memories are their past quiz results: what each student knows well and what they should review.',
  });
  return made.assistant_id ?? made.id;
}

// Reads everything that is remembered. Called once when the server starts.
export async function loadMemory() {
  try {
    for (const record of JSON.parse(fs.readFileSync(FILE(), 'utf8'))) keep(record);
  } catch { /* no file yet: nothing is remembered */ }
  if (!backboardReady()) return { store: 'file', players: records.size };
  try {
    assistantId = await findAssistant();
    let added = 0;
    for (let page = 1; page <= 20; page++) {
      const answer = await backboard('GET', `/assistants/${assistantId}/memories?page=${page}&page_size=100`);
      const memories = answer?.memories ?? [];
      for (const memory of memories) {
        let meta = memory.metadata;
        if (typeof meta === 'string') {
          try {
            meta = JSON.parse(meta);
          } catch {
            meta = null;
          }
        }
        if (meta?.app === 'qr-racer' && keep(meta.record)) added++;
      }
      if (memories.length < 100) break;
    }
    if (added) saveFile();
    return { store: 'backboard', players: records.size };
  } catch (error) {
    assistantId = null;
    console.log(`Backboard could not be reached, so player memory uses the file only: ${error.message}`);
    return { store: 'file', players: records.size };
  }
}

// Remembers one player's race.
// record: { student, name, topic, asked, right, level, weak: [subtopic], strong: [subtopic], at }
export function remember(record) {
  if (!keep(record)) return;
  saveFile();
  if (!assistantId) return;
  const parts = [`${record.name} played a quiz race about "${record.topic}" and got ${record.right} of ${record.asked} questions right, finishing on level ${record.level} of 3.`];
  if (record.strong.length) parts.push(`Strong on: ${record.strong.join(', ')}.`);
  if (record.weak.length) parts.push(`Needs to review: ${record.weak.join(', ')}.`);
  backboard('POST', `/assistants/${assistantId}/memories`, { content: parts.join(' '), metadata: { app: 'qr-racer', student: record.student, record } })
    .catch((error) => console.log(`Backboard could not save a memory: ${error.message}`));
}

// What is known about a player, or null for someone new.
// Returns { races, asked, right, last: their newest record, here: their newest record on `topic` or null }.
export function recall(student, topic) {
  const list = records.get(student);
  if (!list?.length) return null;
  const same = topic.toLowerCase();
  return {
    races: list.length,
    asked: list.reduce((sum, record) => sum + record.asked, 0),
    right: list.reduce((sum, record) => sum + record.right, 0),
    last: list.at(-1),
    here: list.findLast((record) => record.topic.toLowerCase() === same) ?? null,
  };
}
