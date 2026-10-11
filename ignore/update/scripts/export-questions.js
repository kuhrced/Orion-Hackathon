// Copies questions.db into data/questions.json, which the server uses when this Node
// version has no built-in SQLite. Run it after changing the database: npm run export-questions
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const file = (name) => fileURLToPath(new URL(`../${name}`, import.meta.url));
const db = new DatabaseSync(file('questions.db'), { readOnly: true });
const questions = db.prepare('SELECT id, question, choice_a, choice_b, choice_c, choice_d, correct_index, explain_a, explain_b, explain_c, explain_d FROM questions ORDER BY id').all()
  .map((row) => ({
    id: row.id, question: row.question, choices: [row.choice_a, row.choice_b, row.choice_c, row.choice_d], correct: row.correct_index,
    explanations: [row.explain_a, row.explain_b, row.explain_c, row.explain_d],
  }));
fs.writeFileSync(file('data/questions.json'), `${JSON.stringify(questions, null, 1)}\n`);
console.log(`Wrote ${questions.length} questions to data/questions.json`);
