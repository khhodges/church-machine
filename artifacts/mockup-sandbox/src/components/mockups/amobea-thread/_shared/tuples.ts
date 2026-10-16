export type Field = { key: string; label: string; type: 'text' | 'number' | 'status'; words: number };
export type Values = Record<string, string | number>;
export type DemoTuple = { id: number; tx: number; offset: number; values: Values };
export const statuses = ['prepared', 'active', 'waiting for a reply', 'completed', 'cancelled', 'failed'];
const field = (key: string, label: string, type: Field['type'], words: number): Field => ({ key, label, type, words });
export const transactions = [
  { name: 'Phone Mum', purpose: 'Communicate with someone who matters.', schema: 'CallRecord', methods: 'Contact.lookup → Call.prepare', peer: 'Telephone.Thread', authority: 'telephone.request', fields: [field('contact', 'Selected contact', 'text', 8), field('number', 'Telephone number', 'text', 8), field('attempts', 'Attempts', 'number', 1), field('status', 'Call state', 'status', 1)], values: {contact: 'Mum · synthetic', number: '+44 0000 010127', attempts: 0, status: 'prepared'}, payload: ['number'], excluded: 'Contact label, attempts, other Transactions', result: 'Returned call state and outcome; no call is made.' },
  { name: 'Make supper', purpose: 'Turn a plan into an evening meal.', schema: 'SupperRecord', methods: 'Recipe.select → Prep.plan', peer: 'PantryTimer.Thread', authority: 'pantry.read / timer.request', fields: [field('recipe', 'Recipe / ingredients', 'text', 8), field('step', 'Ordered step / timer', 'text', 8), field('servings', 'Servings', 'number', 1), field('status', 'Preparation state', 'status', 1)], values: {recipe: 'Lentils, tomato, rice', step: '1. Rinse rice; timer 12m', servings: 2, status: 'active'}, payload: ['recipe', 'servings'], excluded: 'Other meals and private notes; appliance authority is separate', result: 'Pantry or timer result only; cancellation cannot undo cooking.' },
  { name: 'Ask Claude.ai', purpose: 'Ask a question without sharing everything.', schema: 'QuestionRecord', methods: 'Question.compose → Answer.review', peer: 'AssistantGateway.Thread', authority: 'assistant.request', fields: [field('question', 'Question', 'text', 8), field('context', 'Explicit context / answer', 'text', 8), field('requestId', 'Request identity', 'number', 1), field('status', 'Request state', 'status', 1)], values: {question: 'Explain capability authority', context: 'Synthetic notes only', requestId: 127, status: 'prepared'}, payload: ['question', 'context', 'requestId'], excluded: 'Contacts, calendar, groceries, and unselected private context', result: 'Answer is correlated to this request only; no Claude.ai connection.' },
  { name: 'Buy groceries', purpose: 'Plan necessities within a spending limit.', schema: 'GroceryRecord', methods: 'List.compose → Quote.review', peer: 'Shop.Thread', authority: 'shop.quote; purchase not granted', fields: [field('items', 'Shopping list / quantities', 'text', 8), field('quote', 'Quoted prices / order', 'text', 8), field('limit', 'Limit · synthetic cents', 'number', 1), field('status', 'Order state', 'status', 1)], values: {items: 'Oats x1; apples x4', quote: 'Oats 245; apples 180; draft', limit: 3240, status: 'prepared'}, payload: ['items', 'limit'], excluded: 'Contact details and payment credentials; no purchase authority', result: 'Quote review only. No purchase or payment request is available.' },
  { name: 'Arrange an appointment', purpose: 'Coordinate time while disclosing less.', schema: 'AppointmentRecord', methods: 'Availability.select → Booking.review', peer: 'CalendarProvider.Thread', authority: 'calendar.availability', fields: [field('purpose', 'Purpose / disclosed details', 'text', 8), field('slot', 'Candidate / selected slot', 'text', 8), field('requestId', 'Request identity', 'number', 1), field('status', 'Confirmation state', 'status', 1)], values: {purpose: 'Routine check · synthetic', slot: 'Tue 10:30; Wed 14:15', requestId: 219, status: 'waiting for a reply'}, payload: ['purpose', 'slot', 'requestId'], excluded: 'Unrelated appointments and private calendar details', result: 'Review selected slot and confirmation; no booking is delivered.' },
] as const;
export const RECORD_WORDS = 18;
export function initialTuples(): DemoTuple[] {
  return transactions.map((tx, i) => ({ id: i + 1, tx: i, offset: 18 + i * RECORD_WORDS, values: { ...tx.values } }));
}
export function validateValues(tx: number, value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['Use a JSON object with named schema fields, not an array or null.'];
  const obj = value as Values;
  const fields = transactions[tx].fields;
  const errors = Object.keys(obj).filter(key => !fields.some(f => f.key === key)).map(key => `Unknown field “${key}”. Use the keys shown in the schema.`);
  for (const f of fields) {
    const v = obj[f.key];
    if (f.type === 'text' && (typeof v !== 'string' || !v.trim() || new TextEncoder().encode(v).length > 32)) errors.push(`${f.label}: enter 1–32 UTF-8 bytes to fit its 8-word illustrative slot.`);
    if (f.type === 'number' && (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 2147483647)) errors.push(`${f.label}: use a whole number from 0 to 2,147,483,647.`);
    if (f.type === 'status' && !statuses.includes(String(v))) errors.push(`${f.label}: choose a listed application status.`);
  }
  return errors;
}
export function nextOffset(tuples: DemoTuple[], bodyWords: number): number | undefined {
  for (let offset = 18; offset + RECORD_WORDS <= bodyWords - 12; offset += RECORD_WORDS) {
    if (!tuples.some(t => offset < t.offset + RECORD_WORDS && offset + RECORD_WORDS > t.offset)) return offset;
  }
  return undefined;
}
