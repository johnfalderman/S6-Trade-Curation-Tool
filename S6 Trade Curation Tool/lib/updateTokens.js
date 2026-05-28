// lib/updateTokens.js
// Simple token system for identifying owner+week in update form URLs
// Tokens are stored in Netlify Blobs (same store as the rest of the app)

import { getStore } from '@netlify/blobs';

const TOKEN_EXPIRY_DAYS = 5;

function getTokenStore() {
  return getStore('update-tokens');
}

export async function generateToken(ownerName, ownerEmail) {
  const store = getTokenStore();
  const weekKey = getWeekKey();
  const token = generateRandomToken();

  const tokenData = {
    ownerName,
    ownerEmail,
    weekKey,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    used: false,
  };

  await store.set(`token:${token}`, JSON.stringify(tokenData));
  await store.set(`owner:${ownerName}:${weekKey}`, token);

  return token;
}

export async function getTokenData(token) {
  const store = getTokenStore();
  const raw = await store.get(`token:${token}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function getOrCreateToken(ownerName, ownerEmail) {
  const store = getTokenStore();
  const weekKey = getWeekKey();
  const existingToken = await store.get(`owner:${ownerName}:${weekKey}`);
  if (existingToken) return existingToken;
  return generateToken(ownerName, ownerEmail);
}

export async function markTokenUsed(token) {
  const store = getTokenStore();
  const raw = await store.get(`token:${token}`);
  if (!raw) return;
  const data = JSON.parse(raw);
  data.used = true;
  await store.set(`token:${token}`, JSON.stringify(data));
}

export async function validateToken(token) {
  const data = await getTokenData(token);
  if (!data) return null;
  if (new Date(data.expiresAt) < new Date()) return null;
  return data;
}

function getWeekKey() {
  const now = new Date();
  const year = now.getFullYear();
  const start = new Date(year, 0, 1);
  const week = Math.ceil(((now - start) / 86400000 + start.getDay() + 1) / 7);
  return `${year}-W${week}`;
}

function generateRandomToken() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < 32; i++) {
    token += chars[Math.floor(Math.random() * chars.length)];
  }
  return token;
}
