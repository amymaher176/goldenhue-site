// netlify/functions/analyze.js
// Receives base64-encoded image(s), calls Claude, returns season JSON

const { Anthropic } = require('@anthropic-ai/sdk');

const SYSTEM_PROMPT = `You are an expert color analyst with deep knowledge of the 12-season color analysis system. You are analyzing photo(s) of a person's face to determine their color season. Examine their skin undertone (warm/cool/neutral), skin value (light/medium/deep), hair color and its warmth or coolness, and eye color. Consider how these features interact.

The 12 seasons are:
Spring family (warm, clear): Light Spring, True Spring, Bright Spring
Summer family (cool, muted): Light Summer, True Summer, Soft Summer
Autumn family (warm, muted): Soft Autumn, True Autumn, Dark Autumn
Winter family (cool, clear): True Winter, Deep Winter, Bright Winter

Return ONLY a valid JSON object with no markdown, no preamble, in exactly this structure:
{
"season": "Light Spring",
"family": "Spring",
"confidence": 0.85,
"dominant_trait": "Light",
"secondary_trait": "Neutral-Warm",
"undertone": "Neutral-Warm",
"value": "Light",
"chroma": "Clear",
"feature_notes": "2-3 sentences describing what specifically was observed in the photos — skin tone, hair, eyes",
"character_description": "One sentence capturing the essence of this season",
"best_colors": ["color name 1", "color name 2", "...at least 20 color names accurate to the season"],
"avoid_colors": ["color name 1", "...at least 8 color names to avoid"],
"best_neutrals": ["neutral 1", "neutral 2", "neutral 3", "neutral 4"],
"choose_over": [{"choose": "flamingo pink", "over": "berry"}, "...at least 10 pairs accurate to the season"],
"patterns": "2-3 sentences on patterns that suit this season",
"hair": "2-3 sentences on hair color guidance",
"makeup": "2-3 sentences on makeup colors",
"accessories": "1-2 sentences on metals and accessories",
"sister_season": "season name",
"neighboring_seasons": ["season name", "season name"],
"color_mantra": "3-5 word phrase capturing the season essence e.g. Light and Bright Pastels"
}`;

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // ── Parse body ──
  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  const { images } = body;
  if (!images || !Array.isArray(images) || images.length === 0) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'At least one image is required' }) };
  }
  if (images.length > 3) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Maximum 3 images allowed' }) };
  }

  // ── Validate each image ──
  for (const img of images) {
    if (!img.data || !img.mediaType) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Each image must have data and mediaType fields' }) };
    }
    if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(img.mediaType)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: `Unsupported media type: ${img.mediaType}` }) };
    }
  }

  // ── Build message content ──
  const userContent = [];

  images.forEach((img, i) => {
    if (images.length > 1) {
      userContent.push({ type: 'text', text: `Photo ${i + 1} of ${images.length}:` });
    }
    userContent.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: img.mediaType,
        data: img.data,
      },
    });
  });

  userContent.push({
    type: 'text',
    text: images.length > 1
      ? 'Please analyze all of these photos together to determine this person\'s color season. Use all photos to inform your assessment.'
      : 'Please analyze this photo to determine this person\'s color season.',
  });

  // ── Call Claude ──
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  let result;
  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
    });

    const text = message.content.map(b => b.text || '').join('').trim();
    // Strip any accidental markdown fences
    const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    result = JSON.parse(clean);

  } catch (err) {
    console.error('Claude error:', err);

    // JSON parse failure — Claude may have been uncertain
    if (err instanceof SyntaxError) {
      return {
        statusCode: 422,
        headers,
        body: JSON.stringify({
          error: 'photo_quality',
          message: 'We weren\'t able to determine your season from these photos. This usually happens when the lighting is too dim, the face isn\'t fully visible, or there\'s heavy filtering. Please try again with a clearer photo in natural light.',
        }),
      };
    }

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'server_error',
        message: 'Something went wrong on our end. Please try again in a moment.',
      }),
    };
  }

  // ── Validate minimum required fields ──
  const required = ['season', 'family', 'confidence', 'best_colors', 'avoid_colors'];
  for (const field of required) {
    if (!result[field]) {
      return {
        statusCode: 422,
        headers,
        body: JSON.stringify({
          error: 'incomplete_result',
          message: 'The analysis returned incomplete data. Please try again.',
        }),
      };
    }
  }

  // ── Low confidence fallback ──
  if (result.confidence < 0.5) {
    return {
      statusCode: 422,
      headers,
      body: JSON.stringify({
        error: 'low_confidence',
        message: `We detected a possible ${result.season} season but aren't confident enough to give you a full analysis. The best results come from photos in natural daylight with no makeup and a plain background. Please try again with a clearer photo.`,
        season_hint: result.season,
        confidence: result.confidence,
      }),
    };
  }

  return { statusCode: 200, headers, body: JSON.stringify(result) };
};
