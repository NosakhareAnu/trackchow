const Anthropic = require('@anthropic-ai/sdk');

// Use the smallest/cheapest model to keep token costs low.
const MODEL = 'claude-haiku-4-5-20251001';
// Keep tokens low — we only need a short JSON blob.
const MAX_TOKENS = 500;

let client = null;

function getClient() {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is not set');
    }
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

// Asks Claude to estimate per-100g nutrition for the given food query.
// Returns the parsed object on success, or null if AI is not confident.
// Throws on network/API error.
async function estimateFoodNutrition(query) {
  const prompt = `Return ONLY a JSON object. No explanation, no markdown, no code fences.

If you can confidently estimate nutrition for "${query}", return this structure:
{"confident":true,"name":"canonical food name","category":"meal|snack|drink|ingredient","calories_per_100g":number,"carbs_per_100g":number,"protein_per_100g":number,"fat_per_100g":number,"fiber_per_100g":number,"suggested_serving_units":[{"unit_name":"string","unit_type":"conventional|unconventional","grams":number,"is_default":true|false}]}

Include 1–3 suggested serving units. Exactly one must have is_default:true.
If you cannot confidently estimate, return exactly: {"confident":false}`;

  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = response.content[0]?.text?.trim();
  if (!raw) throw new Error('Empty response from AI');

  // Strip accidental markdown fences
  const cleaned = raw.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();

  const parsed = JSON.parse(cleaned);
  if (!parsed.confident) return null;

  return parsed;
}

module.exports = { estimateFoodNutrition };
