// Loads, caches, and prepares question banks for rooms.

import { aiWarning } from '../ai-policy.js';
import { geminiModel, geminiReady, writeQuestions } from '../gemini.js';
import { bankKey, makeBank, noBank } from './question-bank.js';

export function createQuestionService({ racing, geminiWaitMs, geminiWaitPdfMs, sendState }) {
  const banks = new Map();
  const writing = new Map();

  function writeBank(key, topic, pdf) {
    if (!writing.has(key)) {
      const started = Date.now();
      writing.set(key, writeQuestions(topic, 10, pdf)
        .then((questions) => banks.set(key, makeBank(topic, 'gemini', questions, {
          model: geminiModel(), seconds: Math.round((Date.now() - started) / 100) / 10, from: pdf ? 'pdf' : 'topic',
        })))
        .finally(() => writing.delete(key)));
    }
    return writing.get(key);
  }

  function useBank(room, bank) {
    if (room.bank === bank) return;
    room.bank = bank;
    room.classSeen = new Set();
    for (const player of room.players) player.seen = new Set();
  }

  function prepareBank(room) {
    const topic = room.topic;
    if (room.bank.topic === topic && room.bank.questions.length) {
      room.bankNote = '';
      room.writing = false;
      return;
    }
    const key = bankKey(room);
    const cached = banks.get(key);
    if (cached) {
      useBank(room, cached);
      room.bankNote = '';
      room.writing = false;
      room.pending = null;
      return;
    }
    if (!geminiReady()) {
      useBank(room, noBank(topic));
      room.bankNote = 'No generated questions are available. Add questions on the teacher screen.';
      room.writing = false;
      room.pending = null;
      return;
    }
    if (room.pending === key) return;
    const letDown = room.letDown === key;
    const failed = 'Gemini could not write the questions. Add questions on the teacher screen or try again.';
    const slow = 'Gemini is slow right now. Wait a little longer, or add questions on the teacher screen.';
    useBank(room, noBank(topic));
    room.bankNote = letDown ? failed : '';
    room.writing = !letDown;
    room.pending = key;
    room.writingSince = Date.now();
    const pdf = key === room.pdf?.key ? room.pdf.data : null;
    const giveUp = setTimeout(() => {
      if (room.pending !== key || !room.writing) return;
      room.writing = false;
      room.bankNote = slow;
      sendState(room);
    }, pdf ? geminiWaitPdfMs : geminiWaitMs);
    writeBank(key, topic, pdf).then(() => {
      if (room.pending !== key) return;
      room.writing = false;
      if (racing.has(room.phase)) return;
      room.bankNote = '';
      useBank(room, banks.get(key));
    }).catch((error) => {
      console.log(`Gemini could not write questions: ${error.message}`);
      if (room.pending !== key) return;
      room.writing = false;
      room.letDown = key;
      room.bankNote = aiWarning(error);
    }).finally(() => {
      clearTimeout(giveUp);
      if (room.pending === key) room.pending = null;
      sendState(room);
    });
  }

  return { banks, prepareBank, useBank, writeBank };
}
