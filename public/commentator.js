// The voice on the big screen. It reads the question out when it appears and the right answer
// when time is up; the server sends the words, and a sound clip from ElevenLabs when it has one.
// Without a clip, the browser's own voice reads the words.

const SAVED = 'race-commentator-muted';

export function createCommentator() {
  const queue = [];
  let playing = null; // the sound clip being played
  let finish = null; // ends the line that is being read now
  let muted = false;
  try {
    muted = localStorage.getItem(SAVED) === '1';
  } catch { /* private mode: start with the sound on */ }

  function quiet() {
    playing?.pause();
    playing = null;
    window.speechSynthesis?.cancel();
  }

  // Reads the line out with the voice built into the browser.
  function browserVoice(text, done) {
    const speech = window.speechSynthesis;
    if (!speech) return;
    const line = new SpeechSynthesisUtterance(text);
    const voices = speech.getVoices().filter((voice) => voice.lang.startsWith('en'));
    line.voice = voices.find((voice) => /Daniel|Google UK English Male|Aaron|Alex/.test(voice.name)) ?? voices[0] ?? null;
    line.lang = line.voice?.lang ?? 'en-US';
    line.rate = 1.05;
    line.onend = line.onerror = done;
    speech.cancel(); // one line at a time
    speech.speak(line);
  }

  function next() {
    if (finish) return; // a line is still being read
    const line = queue.shift();
    if (!line || muted) return;
    let over = false;
    const done = () => {
      if (over) return;
      over = true;
      clearTimeout(guard);
      finish = null;
      playing = null;
      next();
    };
    // Whatever happens to the sound, the line ends: browsers sometimes never say "finished".
    const guard = setTimeout(done, 2500 + line.text.length * 95);
    finish = done;
    if (!line.audio) return browserVoice(line.text, done);
    // If the clip cannot be played, the browser's own voice reads the line: once, although a
    // clip that fails can report it in two ways.
    let fellBack = false;
    const fallBack = () => {
      if (fellBack || over) return;
      fellBack = true;
      browserVoice(line.text, done);
    };
    playing = new Audio(line.audio);
    playing.onended = done;
    playing.onerror = fallBack;
    playing.play().catch(fallBack);
  }

  return {
    // line: { text, audio, cut }. `cut` stops what is being read: the answer does not wait
    // for the end of the question.
    say(line) {
      if (line.cut) {
        queue.length = 0;
        const ending = finish;
        quiet();
        ending?.();
      }
      queue.push(line);
      while (queue.length > 2) queue.shift();
      next();
    },
    get muted() {
      return muted;
    },
    toggle() {
      muted = !muted;
      try {
        localStorage.setItem(SAVED, muted ? '1' : '0');
      } catch { /* not saved, still works */ }
      if (muted) {
        queue.length = 0;
        const ending = finish;
        quiet();
        ending?.();
      }
      return muted;
    },
  };
}
