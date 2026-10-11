// Checks that the Gemini key in .env works, by asking for a small set of questions.
// Run: npm run try-gemini            (topic: The environment)
//      npm run try-gemini -- Volcanoes
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { geminiReady, writeQuestions } from '../gemini.js';

try {
  process.loadEnvFile(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env'));
} catch { /* no .env file */ }

if (!geminiReady()) {
  console.log('No key found. Put GEMINI_API_KEY=your-key in the .env file, then run this again.');
  process.exit(1);
}
const topic = process.argv.slice(2).join(' ') || 'The environment';
console.log(`Asking Gemini for questions about "${topic}"...`);
try {
  const started = Date.now();
  const questions = await writeQuestions(topic, 6);
  console.log(`It works. ${questions.length} questions in ${((Date.now() - started) / 1000).toFixed(1)} seconds. One from each level:`);
  for (const level of [1, 2, 3]) {
    const q = questions.find((item) => item.level === level);
    console.log(`\n[${['', 'easy', 'medium', 'hard'][level]} | ${q.subtopic}] ${q.question}`);
    q.choices.forEach((choice, i) => console.log(`  ${i === q.correct ? '✓' : ' '} ${choice}`));
  }
} catch (error) {
  console.log(`It did not work: ${error.message}`);
  process.exit(1);
}
