// netlify/functions/classify.js
// Receives imageUrl + auth token, calls Claude, returns season result

const { Anthropic } = require('@anthropic-ai/sdk');

const FREE_LIMIT = 10;

// In production replace with a real DB (Supabase, PlanetScale, etc.)
// For MVP this uses Netlify Blobs (key-value store)
const { getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ message: 'Method not allowed' }) };
  }

  // ── Auth ──
  const authHeader = event.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) {
    return { statusCode: 401, headers, body: JSON.stringify({ message: 'No token provided' }) };
  }

  // ── Look up token ──
  const store = getStore('gh-users');
  let userData;
  try {
    const raw = await store.get(token);
    if (!raw) throw new Error('Token not found');
    userData = JSON.parse(raw);
  } catch {
    return { statusCode: 401, headers, body: JSON.stringify({ message: 'Invalid or expired token' }) };
  }

  // ── Credit check ──
  const isPro = userData.type === 'pro';
  if (!isPro && (userData.credits_used || 0) >= FREE_LIMIT) {
    return {
      statusCode: 402, headers,
      body: JSON.stringify({ message: 'No credits remaining. Upgrade at goldenhue.shop to continue.' })
    };
  }

  // ── Parse body ──
  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ message: 'Invalid request body' }) };
  }

  const { imageUrl } = body;
  if (!imageUrl || !imageUrl.startsWith('http')) {
    return { statusCode: 400, headers, body: JSON.stringify({ message: 'Valid imageUrl required' }) };
  }

  // ── Call Claude ──
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const prompt = `You are a professional color analysis expert specialising in the 12-season color analysis system.

Analyse this clothing/fashion image and determine which of the 12 color seasons it belongs to.

The 12 seasons are:
Spring: Light Spring, True Spring, Bright Spring
Summer: Light Summer, True Summer, Soft Summer
Autumn: Soft Autumn, True Autumn, Dark Autumn
Winter: True Winter, Deep Winter, Bright Winter

Respond ONLY with a JSON object — no markdown, no preamble:
{
  "season": "True Autumn",
  "family": "Autumn",
  "confidence": 0.87,
  "reasoning": "2-3 sentence explanation of why this season",
  "undertone": "warm",
  "value": "medium",
  "chroma": "muted",
  "key_colors_present": ["rust", "camel", "olive"]
}`;

  let result;
  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'url', url: imageUrl } },
          { type: 'text', text: prompt }
        ]
      }]
    });

    const text = message.content.map(b => b.text || '').join('').trim();
    const clean = text.replace(/```json|```/g, '').trim();
    result = JSON.parse(clean);

  } catch (err) {
    console.error('Claude error:', err);
    return {
      statusCode: 500, headers,
      body: JSON.stringify({ message: 'Classification failed. The image may not be accessible.' })
    };
  }

  // ── Deduct credit ──
  if (!isPro) {
    userData.credits_used = (userData.credits_used || 0) + 1;
    await store.set(token, JSON.stringify(userData));
  }

  return { statusCode: 200, headers, body: JSON.stringify(result) };
};
