# Update: question explanations

After each question, players now see why the right answer is right and why their answer was wrong, with time to read before the race continues.

These are only the files changed for this update (branch `question-explanations`, commit `78a3a26`). The folders match the repo layout, so each file goes in the same place in the project.

| File | What changed |
| --- | --- |
| `questions.db` | New columns `explain_a` to `explain_d`: one explanation per answer choice, for all 100 questions |
| `data/questions.json` | Re-exported from the database, now with explanations |
| `scripts/export-questions.js` | Also exports the explanations |
| `server.js` | Sends explanations after a question closes; reading time of 15-40 s based on text length; handles "Got it" from phones and "Continue" from the big screen |
| `public/play.js`, `public/play.html` | Phone: explanation cards, reading timer, "Got it, keep racing" button; adds the missing `element()` helper |
| `public/host.js`, `public/host.html` | Big screen: right answer and most-picked wrong answer with explanations, "x of y done reading", Continue button |
| `public/style.css` | Styles for the explanation cards and buttons |

## How to apply it

These files were made from `main` as of Version 0.03. `main` has changed since then (Version 0.035 edits `server.js`, `public/host.js` and `public/play.js`), so copying those files over would undo the newer changes.

Safest: merge the `question-explanations` branch on GitHub, or apply the patch, which only changes the lines this update touches:

```bash
git apply --3way question-explanations.patch
```

`questions.db` and `data/questions.json` can be copied over as they are.
