// Talks to Gemini. Everything here is optional: without a key, or if a call fails, the game
// carries on with the backup questions in data/questions.json.
//
// The key comes from GEMINI_API_KEY in the .env file. It is never logged or sent to a browser.

const MODEL = () => process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const LEVELS = { easy: 1, medium: 2, hard: 3 };

export const geminiReady = () => !!process.env.GEMINI_API_KEY;

async function ask(prompt, schema) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL()}:generateContent`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: 'application/json', responseJsonSchema: schema, temperature: 0.8 },
  };
  const post = () => fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45000),
  });
  let response = await post();
  if (response.status === 400) {
    // Some versions of the API do not know the schema field. Ask again without it; the
    // answer is checked piece by piece below either way.
    delete body.generationConfig.responseJsonSchema;
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
export async function writeQuestions(topic, perLevel = 12) {
  const prompt = `Write multiple-choice quiz questions for school students aged 11 to 16.
Topic: ${topic}

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
- Give each question a subtopic: a label of 1 to 3 words. Use only 5 or 6 different subtopics in total.
- Do not repeat a question.`;
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
  const answer = await ask(prompt, schema);
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
    if (questions.filter((q) => q.level === level).length < 5) throw new Error('Gemini did not write enough usable questions');
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
what to review next, using only the results above. Speak to the player as "you". Simple words. No emojis.`;
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
