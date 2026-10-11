// Shared guardrails for every AI feature.
// Keeping limits and safety checks here prevents individual callers from quietly
// growing their own, inconsistent Gemini usage.

const WINDOW_MS = 10 * 60 * 1000;
const LIMITS = { questions: 3, feedback: 12 };
const calls = new Map();

const SENSITIVE_TOPIC = /\b(?:adult|abuse|assault|bomb|drug|drugs|erotic|execution|extrem(?:e|ism|ist)|gore|graphic violence|hate|hateful|kill|murder|nude|porn|self[ -]?harm|sex|sexual|suicide|terror|torture|weapon|weapons)\b/i;
const UNSAFE_CONTENT = /\b(?:child sexual|explicit sex|graphic(?:ally)? violent|how to (?:make|build) (?:a )?(?:bomb|weapon|drug)|instructions? for (?:suicide|self[ -]?harm)|racial slur)\b/i;

export function sensitiveTopic(topic) {
  return SENSITIVE_TOPIC.test(String(topic ?? ''));
}

export function reserveAi(kind, scope = 'global') {
  const limit = LIMITS[kind] ?? 1;
  const key = `${kind}:${scope}`;
  const now = Date.now();
  const recent = (calls.get(key) ?? []).filter((at) => now - at < WINDOW_MS);
  if (recent.length >= limit) {
    const retryAfterMs = WINDOW_MS - (now - recent[0]);
    calls.set(key, recent);
    const error = new Error(`AI rate limit reached. Try again in about ${Math.ceil(retryAfterMs / 60000)} minute(s).`);
    error.code = 'AI_RATE_LIMIT';
    error.retryAfterMs = retryAfterMs;
    throw error;
  }
  recent.push(now);
  calls.set(key, recent);
}

export function assertSafeText(text, label = 'AI response') {
  if (UNSAFE_CONTENT.test(String(text ?? ''))) {
    const error = new Error(`${label} was not safe for classroom use. Please retry with another topic.`);
    error.code = 'AI_UNSAFE_CONTENT';
    throw error;
  }
}

export function assertSafeQuestions(questions) {
  for (const question of questions) {
    assertSafeText([question.question, question.subtopic, ...(question.choices ?? [])].join(' '), 'Generated questions');
  }
}

export const aiWarning = (error) => error?.code === 'AI_RATE_LIMIT'
  ? error.message
  : error?.code === 'AI_UNSAFE_CONTENT' || error?.code === 'AI_SENSITIVE_TOPIC'
    ? 'That topic may not be safe for classroom use. Please retry with a different topic.'
    : 'The AI could not create safe questions. Please retry your topic.';
