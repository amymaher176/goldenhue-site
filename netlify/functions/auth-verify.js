// netlify/functions/auth-verify.js
// Verifies OTP code, issues a session token, creates user record

const { getStore } = require('@netlify/blobs');
const crypto = require('crypto');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ message: 'Method not allowed' }) };

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ message: 'Invalid request' }) }; }

  const email = (body.email || '').toLowerCase().trim();
  const code  = (body.code  || '').trim();

  if (!email || !code) {
    return { statusCode: 400, headers, body: JSON.stringify({ message: 'Email and code required' }) };
  }

  // Fetch stored OTP
  const blobsConfig = { siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_BLOBS_TOKEN };
  const otpStore = getStore({ name: 'gh-otp', ...blobsConfig });
  let otpData;
  try {
    const raw = await otpStore.get(email);
    if (!raw) throw new Error('No code found');
    otpData = JSON.parse(raw);
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ message: 'Code expired or not found. Request a new one.' }) };
  }

  // Check expiry
  if (Date.now() > otpData.expiresAt) {
    await otpStore.delete(email);
    return { statusCode: 400, headers, body: JSON.stringify({ message: 'Code expired. Request a new one.' }) };
  }

  // Check attempts (max 5)
  if (otpData.attempts >= 5) {
    await otpStore.delete(email);
    return { statusCode: 400, headers, body: JSON.stringify({ message: 'Too many attempts. Request a new code.' }) };
  }

  // Verify code
  if (otpData.code !== code) {
    otpData.attempts++;
    await otpStore.set(email, JSON.stringify(otpData));
    return { statusCode: 400, headers, body: JSON.stringify({ message: 'Incorrect code. Try again.' }) };
  }

  // ✅ Code valid — delete OTP, create/update user, issue token
  await otpStore.delete(email);

  const userStore = getStore({ name: 'gh-users', ...blobsConfig });
  const token = crypto.randomBytes(32).toString('hex');

  // Check if user already exists (may have old token)
  // Store by email to look up existing credits
  let existingUser;
  try {
    const raw = await userStore.get(`email:${email}`);
    if (raw) existingUser = JSON.parse(raw);
  } catch {}

  const userData = {
    email,
    type: existingUser?.type || 'free',
    credits_used: existingUser?.credits_used || 0,
    created_at: existingUser?.created_at || new Date().toISOString(),
    last_seen: new Date().toISOString(),
  };

  // Store user by token (for fast auth lookup) and by email (for credit persistence)
  await userStore.set(token, JSON.stringify(userData));
  await userStore.set(`email:${email}`, JSON.stringify({ ...userData, token }));

  return { statusCode: 200, headers, body: JSON.stringify({ token }) };
};
