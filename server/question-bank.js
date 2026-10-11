// Question-bank primitives shared by the game server and question tooling.
// AI generation and safety policy live in gemini.js and ai-policy.js.

export const makeBank = (topic, source, questions, made = {}) => ({
  topic,
  source,
  count: questions.length,
  made,
  questions,
  levels: [null, 1, 2, 3].map((level) => (level ? questions.filter((q) => q.level === level) : null)),
});

export const noBank = (topic) => makeBank(topic, 'empty', []);
export const bankKey = (room) => room.pdf?.topic === room.topic ? room.pdf.key : room.topic.toLowerCase();

