// Copies questions.db into data/questions.json, which is what the server reads as its backup
// questions. Run it after changing the database: npm run export-questions
// The database has no difficulty or subtopic, so those are kept from the existing JSON file.
// A question that is new gets level 2 (medium) until someone sets it by hand.
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const file = (name) => fileURLToPath(new URL(`../${name}`, import.meta.url));
const known = new Map(JSON.parse(fs.readFileSync(file('data/questions.json'), 'utf8')).map((q) => [q.id, q]));
const db = new DatabaseSync(file('questions.db'), { readOnly: true });
const questions = db.prepare('SELECT id, question, choice_a, choice_b, choice_c, choice_d, correct_index FROM questions ORDER BY id').all()
  .map((row) => ({
    id: row.id, question: row.question, choices: [row.choice_a, row.choice_b, row.choice_c, row.choice_d], correct: row.correct_index,
    level: known.get(row.id)?.level ?? 2, subtopic: known.get(row.id)?.subtopic ?? 'General',
  }));
fs.writeFileSync(file('data/questions.json'), `${JSON.stringify(questions, null, 1)}\n`);
console.log(`Wrote ${questions.length} questions to data/questions.json`);
