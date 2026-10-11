// The commentator on the big screen. The server decides what is said and sends the words, and
// a sound clip from ElevenLabs when it has one. Without a clip, the browser's own voice reads
// the words out. The words are always shown too, because a hackathon hall is loud.

const SAVED = 'race-commentator-muted';

export function createCommentator(caption) {
  const queue = [];
  let busy = false;
  let playing = null; // the sound clip being played
  let muted = false;
  try {
    muted = localStorage.getItem(SAVED) === '1';
  } catch { /* private mode: start with the sound on */ }

  // Reads the line out with the voice built into the browser.
  function browserVoice(text, done) {
    const speech = window.speechSynthesis;
    if (!speech) return;
    const line = new SpeechSynthesisUtterance(text);
    const voices = speech.getVoices().filter((voice) => voice.lang.startsWith('en'));
    line.voice = voices.find((voice) => /Daniel|Google UK English Male|Aaron|Alex/.test(voice.name)) ?? voices[0] ?? null;
    line.lang = line.voice?.lang ?? 'en-US';
    line.rate = 1.15;
    line.pitch = 1.05;
    line.onend = line.onerror = done;
    speech.cancel(); // never let lines pile up behind the race
    speech.speak(line);
  }

  function next() {
    if (busy) return;
    const line = queue.shift();
    if (!line) return;
    busy = true;
    caption.textContent = line.text;
    caption.hidden = false;
    let over = false;
    const done = () => {
      if (over) return;
      over = true;
      clearTimeout(guard);
      setTimeout(() => {
        busy = false;
        playing = null;
        if (!queue.length) caption.hidden = true;
        next();
      }, 350);
    };
    // Whatever happens to the sound, the line ends: browsers sometimes never say "finished".
    const guard = setTimeout(done, muted ? 1200 + line.text.length * 55 : 2500 + line.text.length * 95);
    if (muted) return;
    if (!line.audio) return browserVoice(line.text, done);
    playing = new Audio(line.audio);
    playing.onended = done;
    playing.onerror = () => browserVoice(line.text, done);
    playing.play().catch(() => browserVoice(line.text, done));
  }

  return {
    // line: { text, audio }. Only the newest lines are kept: old news is not worth saying.
    say(line) {
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
        playing?.pause();
        window.speechSynthesis?.cancel();
      }
      return muted;
    },
  };
}
