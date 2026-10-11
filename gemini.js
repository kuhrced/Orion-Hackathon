// Talks to Gemini. Everything here is optional: without a key, or if a call fails, the game
// The server requires generated or teacher-created questions; there is no built-in fallback.
//
// The key comes from GEMINI_API_KEY in the .env file. It is never logged or sent to a browser.

// The "lite" model on purpose: it wrote 30 questions in 5 seconds in testing, and the free plan
// lets it be called far more often than the bigger models, which ran out of quota at once.
const MODEL = () => process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
const LEVELS = { easy: 1, medium: 2, hard: 3 };

export const geminiReady = () => !!process.env.GEMINI_API_KEY;
export const geminiModel = MODEL;

// `pdf` is an optional Buffer holding a PDF for Gemini to read along with the prompt.
async function ask(prompt, schema, pdf = null) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL()}:generateContent`;
  const body = {
    contents: [{ parts: [...(pdf ? [{ inline_data: { mime_type: 'application/pdf', data: pdf.toString('base64') } }] : []), { text: prompt }] }],
    // Low thinking: writing quiz questions does not need deep reasoning, and it is about three
    // times faster (measured: 8 questions in 5 seconds instead of 15).
    generationConfig: { responseMimeType: 'application/json', responseJsonSchema: schema, temperature: 0.8, thinkingConfig: { thinkingLevel: 'low' } },
  };
  const post = () => fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(pdf ? 120000 : 60000), // reading a document takes longer
  });
  let response = await post();
  // 429 means too many requests this minute (the free plan allows only a few), and 503 means
  // Gemini is busy. Both pass, so wait and try again before giving up.
  for (const wait of [8000, 20000]) {
    if (response.status !== 429 && response.status !== 503) break;
    await new Promise((resolve) => setTimeout(resolve, wait));
    response = await post();
  }
  // Some models do not know the thinking setting or the schema field. Drop them one at a
  // time and ask again; the answer is checked piece by piece either way.
  for (const setting of ['thinkingConfig', 'responseJsonSchema']) {
    if (response.status !== 400) break;
    delete body.generationConfig[setting];
    response = await post();
  }
  if (!response.ok) throw new Error(`Gemini answered ${response.status}: ${(await response.text()).slice(0, 200)}`);
  const data = await response.json();
  const text = (data.candidates?.[0]?.content?.parts ?? []).map((part) => part.text ?? '').join('');
  return JSON.parse(text);
}

const text = (value, max) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');

function shuffled(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Asks Gemini for quiz questions on a topic at three levels. Returns them in the same shape
// as the backup questions: { id, question, choices, correct, level, subtopic }. Anything that
// does not look right is thrown away, and too few good ones is treated as a failure.
//
// This is one request on purpose. The free plan allows only a few requests a minute, so a
// request per level would run out as soon as two rooms started at once.
//
// With `pdf` (a Buffer), the questions are about what the document says, not about the topic
// in general: this is how a teacher turns their own handout into a quiz.
export async function writeQuestions(topic, perLevel = 10, pdf = null) {
  const prompt = `Write multiple-choice quiz questions for school students aged 11 to 16.
${pdf ? 'Base every question on the attached document. Ask only about things the document says.' : `Topic: ${topic}`}

Write ${perLevel} easy, ${perLevel} medium and ${perLevel} hard questions.
- easy: everyday knowledge that most students already have.
- medium: needs one idea that is taught in class.
- hard: needs specific knowledge, or two steps of reasoning.

Rules:
- Every fact must be accurate and not controversial.
- A question is at most 110 characters. Plain text only.
- Exactly 4 answer choices, each at most 70 characters. Exactly one is correct.
- Wrong choices must be believable but clearly wrong to someone who knows the topic.
- Do not use "all of the above" or "none of the above".
- Give each question a subtopic: a label of 1 to 3 words. Use only 5 or 6 different subtopics in
  total, and spread the questions of every level over them.
- Do not repeat a question.

Return JSON in exactly this shape:
{"questions": [{"level": "easy", "subtopic": "...", "question": "...", "choices": ["...", "...", "...", "..."], "correct_index": 0}]}`;
  const schema = {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            level: { type: 'string', enum: ['easy', 'medium', 'hard'] },
            subtopic: { type: 'string' },
            question: { type: 'string' },
            choices: { type: 'array', items: { type: 'string' }, minItems: 4, maxItems: 4 },
            correct_index: { type: 'integer', minimum: 0, maximum: 3 },
          },
          required: ['level', 'subtopic', 'question', 'choices', 'correct_index'],
        },
      },
    },
    required: ['questions'],
  };
  const answer = await ask(prompt, schema, pdf);
  const seen = new Set();
  const questions = [];
  for (const item of Array.isArray(answer?.questions) ? answer.questions : []) {
    const question = text(item?.question, 160);
    const choices = Array.isArray(item?.choices) ? item.choices.map((choice) => text(choice, 90)) : [];
    const level = LEVELS[item?.level];
    const right = choices[item?.correct_index];
    if (!level || question.length < 8 || seen.has(question) || choices.length !== 4 || !right) continue;
    if (choices.some((choice) => !choice) || new Set(choices).size !== 4) continue;
    seen.add(question);
    // Gemini tends to put the right answer in the same place; mix the order up.
    const mixed = shuffled(choices);
    questions.push({ id: `g${questions.length}`, question, choices: mixed, correct: mixed.indexOf(right), level, subtopic: text(item.subtopic, 30) || 'General' });
  }
  for (const level of [1, 2, 3]) {
    const usable = questions.filter((q) => q.level === level).length;
    if (usable < Math.min(5, perLevel)) throw new Error(`Gemini only wrote ${usable} usable questions at level ${level}`);
  }
  return questions;
}

// Asks Gemini for one short sentence for each player about what they know and what to review.
// players: [{ id, name, answers: [{ subtopic, level, right }] }]. Returns a Map of id -> sentence.
export async function writeFeedback(topic, players) {
  const prompt = `These are quiz results from a classroom game. Topic: ${topic}
Levels: 1 easy, 2 medium, 3 hard.

${JSON.stringify(players)}

For each player write ONE short, friendly sentence of at most 110 characters. Say what they know well and
what to review next, using only the results above. Speak to the player as "you". Simple words. No emojis.

Return JSON in exactly this shape: {"notes": [{"id": 1, "note": "..."}]}`;
  const schema = {
    type: 'object',
    properties: {
      notes: {
        type: 'array',
        items: { type: 'object', properties: { id: { type: 'integer' }, note: { type: 'string' } }, required: ['id', 'note'] },
      },
    },
    required: ['notes'],
  };
  const answer = await ask(prompt, schema);
  const notes = new Map();
  for (const item of Array.isArray(answer?.notes) ? answer.notes : []) {
    const note = text(item?.note, 160);
    if (Number.isInteger(item?.id) && note) notes.set(item.id, note);
  }
  return notes;
}
