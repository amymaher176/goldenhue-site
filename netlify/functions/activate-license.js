// netlify/functions/activate-license.js
// Validates a license key, upgrades user to pro

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

  const licenseKey = (body.licenseKey || '').toUpperCase().trim();
  if (!licenseKey) {
    return { statusCode: 400, headers, body: JSON.stringify({ message: 'License key required' }) };
  }

  // Look up the license key
  const licenseStore = getStore('gh-licenses');
  let licenseData;
  try {
    const raw = await licenseStore.get(licenseKey);
    if (!raw) throw new Error('Not found');
    licenseData = JSON.parse(raw);
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ message: 'Invalid license key. Check your purchase confirmation email.' }) };
  }

  // Check if already used (optional: allow re-activation on same email)
  if (licenseData.activated && licenseData.activated_email) {
    // Already activated — re-issue a token for the same email
    const token = crypto.randomBytes(32).toString('hex');
    const userStore = getStore('gh-users');
    const userData = {
      email: licenseData.activated_email,
      type: 'pro',
      credits_used: 0,
      created_at: new Date().toISOString(),
      last_seen: new Date().toISOString(),
    };
    await userStore.set(token, JSON.stringify(userData));
    return { statusCode: 200, headers, body: JSON.stringify({ token, email: licenseData.activated_email }) };
  }

  // First activation
  const token = crypto.randomBytes(32).toString('hex');
  const email  = licenseData.email || `license:${licenseKey}`;

  const userStore = getStore('gh-users');
  const userData = {
    email,
    type: 'pro',
    credits_used: 0,
    created_at: new Date().toISOString(),
    last_seen: new Date().toISOString(),
  };

  await userStore.set(token, JSON.stringify(userData));

  // Mark license as activated
  await licenseStore.set(licenseKey, JSON.stringify({
    ...licenseData,
    activated: true,
    activated_at: new Date().toISOString(),
    activated_email: email,
  }));

  return { statusCode: 200, headers, body: JSON.stringify({ token, email }) };
};
