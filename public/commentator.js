// The voice on the big screen. It reads the question out when it appears and the right answer
// when time is up; the server sends the words, and a sound clip from ElevenLabs when it has one.
// Without a clip, the browser's own voice reads the words.
//
// One rule above all: never two voices at once. A line starts only after everything before it
// has been stopped, and after a short silence.

const SAVED = 'race-commentator-muted';
const GAP = 300; // silence, in milliseconds, between stopping one line and starting the next

export function createCommentator() {
  const queue = [];
  const clips = new Set(); // every sound clip that may still be playing
  let speaking = null; // the browser-voice line being read (kept so its "finished" event is not lost)
  let finish = null; // ends the line that is being read now
  let muted = false;
  try {
    muted = localStorage.getItem(SAVED) === '1';
  } catch { /* private mode: start with the sound on */ }

  const speech = window.speechSynthesis;
  speech?.getVoices(); // some browsers only load the list of voices after the first ask

  // Stops every sound this page has started.
  function quiet() {
    for (const clip of clips) clip.pause();
    clips.clear();
    speaking = null;
    speech?.cancel();
  }

  // A voice that lives on this computer. Voices that come over the internet (the "Google ..."
  // ones in Chrome) start late and do not stop at once, so two lines could be heard together.
  function pickVoice() {
    const english = speech.getVoices().filter((voice) => voice.lang.startsWith('en'));
    const local = english.filter((voice) => voice.localService);
    const from = local.length ? local : english;
    return from.find((voice) => /Daniel|Aaron|Alex|George|Ryan|David|Mark|Guy/.test(voice.name)) ?? from[0] ?? null;
  }

  // Reads the line out with the voice built into the browser.
  function browserVoice(text, done) {
    if (!speech) return;
    const line = new SpeechSynthesisUtterance(text);
    line.voice = pickVoice();
    line.lang = line.voice?.lang ?? 'en-US';
    line.rate = 1.05;
    line.onend = line.onerror = () => {
      if (speaking === line) speaking = null;
      done();
    };
    speaking = line;
    speech.speak(line);
  }

  function next() {
    if (finish) return; // a line is still being read
    const line = queue.shift();
    if (!line || muted) return;
    let over = false;
    let clip = null;
    const done = () => {
      if (over) return;
      over = true;
      clearTimeout(guard);
      clearTimeout(starting);
      if (clip) { // a clip that is still going must not play on under the next line
        clip.pause();
        clips.delete(clip);
      }
      finish = null;
      next();
    };
    // Whatever happens to the sound, the line ends: browsers sometimes never say "finished".
    const guard = setTimeout(done, line.wait + 2500 + line.text.length * 95);
    finish = done;
    const starting = setTimeout(() => {
      if (over) return;
      // Something left over from before (a voice the browser did not stop) goes first.
      if (speech && (speech.speaking || speech.pending)) speech.cancel();
      if (!line.audio) return browserVoice(line.text, done);
      // If the clip cannot be played, the browser's own voice reads the line: once, although a
      // clip that fails can report it in two ways.
      let fellBack = false;
      const fallBack = () => {
        if (fellBack || over) return;
        fellBack = true;
        clip.pause();
        clips.delete(clip);
        browserVoice(line.text, done);
      };
      clip = new Audio(line.audio);
      clips.add(clip);
      clip.onended = done;
      clip.onerror = fallBack;
      clip.play().catch(fallBack);
    }, line.wait);
  }

  // Stops what is being read and forgets what was waiting.
  function stopAll() {
    queue.length = 0;
    const ending = finish;
    quiet();
    ending?.();
  }

  return {
    // line: { text, audio, cut }. `cut` stops what is being read (the answer does not wait for
    // the end of the question); the new line then starts after a short silence.
    say(line) {
      const busy = !!finish || !!speech?.speaking;
      if (line.cut && busy) stopAll();
      queue.push({ ...line, wait: line.cut && busy ? GAP : 0 });
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
      if (muted) stopAll();
      return muted;
    },
  };
}
