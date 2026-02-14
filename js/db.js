// db.js — API client for Cloudflare D1 backend
// Replaces Dexie (IndexedDB) with fetch() calls to /api/*
// All exported function signatures remain the same for compatibility.

import { bus } from './utils.js';

let authToken = localStorage.getItem('ulysses_token');

// --- API helper ---
async function api(path, { method = 'GET', body } = {}) {
  const opts = {
    method,
    headers: { 'Authorization': `Bearer ${authToken}` },
  };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`/api${path}`, opts);
  if (res.status === 401) {
    bus.emit('auth:required');
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'API error');
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export function setAuthToken(token) {
  authToken = token;
  localStorage.setItem('ulysses_token', token);
}

export function clearAuth() {
  authToken = null;
  localStorage.removeItem('ulysses_token');
}

export function isAuthenticated() {
  return !!authToken;
}

export async function verifyAuth() {
  try {
    await api('/groups');
    return true;
  } catch {
    return false;
  }
}

// --- Groups ---
export async function getGroups() {
  return api('/groups');
}

export async function getGroup(id) {
  const groups = await api('/groups');
  return groups.find(g => g.id === id) || null;
}

export async function createGroup(name, parentId = null, section = null) {
  return api('/groups', { method: 'POST', body: { name, parentId, section } });
}

export async function updateGroup(id, changes) {
  return api(`/groups/${id}`, { method: 'PUT', body: changes });
}

export async function deleteGroup(id) {
  return api(`/groups/${id}`, { method: 'DELETE' });
}

export async function reorderGroups(orderedIds) {
  for (let i = 0; i < orderedIds.length; i++) {
    await api(`/groups/${orderedIds[i]}`, { method: 'PUT', body: { sortOrder: i } });
  }
}

// --- Sheets ---
export async function getSheets(groupId, sortBy = 'manual') {
  return api(`/sheets?groupId=${groupId}&sort=${sortBy}`);
}

export async function getAllSheets() {
  return api('/sheets?filter=all');
}

export async function getSheet(id) {
  return api(`/sheets/${id}`);
}

export async function createSheet(groupId, title = '', content = '') {
  return api('/sheets', { method: 'POST', body: { groupId, title, content } });
}

export async function updateSheet(id, changes) {
  return api(`/sheets/${id}`, { method: 'PUT', body: changes });
}

export async function trashSheet(id) {
  return api('/sheets/trash', { method: 'POST', body: { ids: [id], restore: false } });
}

export async function restoreSheet(id) {
  return api('/sheets/trash', { method: 'POST', body: { ids: [id], restore: true } });
}

export async function deleteSheet(id) {
  return api(`/sheets/${id}`, { method: 'DELETE' });
}

export async function trashSheets(ids) {
  return api('/sheets/trash', { method: 'POST', body: { ids, restore: false } });
}

export async function moveSheet(id, newGroupId) {
  return api('/sheets/move', { method: 'POST', body: { ids: [id], groupId: newGroupId } });
}

export async function moveSheets(ids, newGroupId) {
  return api('/sheets/move', { method: 'POST', body: { ids, groupId: newGroupId } });
}

export async function reorderSheets(orderedIds) {
  return api('/sheets/reorder', { method: 'POST', body: { ids: orderedIds } });
}

export async function toggleFavorite(id) {
  const result = await api('/sheets/favorite', { method: 'POST', body: { id } });
  return result.favorite;
}

// --- Smart Filters ---
export async function getFilteredSheets(filter) {
  return api(`/sheets?filter=${filter}`);
}

export async function getFilterCounts() {
  return api('/filter-counts');
}

export async function emptyTrash() {
  return api('/sheets/empty-trash', { method: 'POST' });
}

// --- Merge ---
export async function mergeSheets(ids, groupId) {
  return api('/sheets/merge', { method: 'POST', body: { ids, groupId } });
}

export async function undoMerge(mergedId, originalIds) {
  await api('/sheets/trash', { method: 'POST', body: { ids: originalIds, restore: true } });
  await api(`/sheets/${mergedId}`, { method: 'DELETE' });
}

// --- Tags ---
export async function getTags() {
  return api('/tags');
}

export async function createTag(name, color = '#888') {
  return api('/tags', { method: 'POST', body: { name, color } });
}

export async function updateTag(id, changes) {
  return api(`/tags/${id}`, { method: 'PUT', body: changes });
}

export async function deleteTag(id) {
  return api(`/tags/${id}`, { method: 'DELETE' });
}

export async function getSheetTags(sheetId) {
  return api(`/sheet-tags/${sheetId}`);
}

export async function addTagToSheet(sheetId, tagId) {
  return api('/sheet-tags', { method: 'POST', body: { sheetId, tagId } });
}

export async function removeTagFromSheet(sheetId, tagId) {
  return api(`/sheet-tags/${sheetId}/${tagId}`, { method: 'DELETE' });
}

export async function getSheetsByTag(tagId) {
  // Fetch all sheets and filter by tag client-side (simple approach)
  const tags = await api(`/sheet-tags/${tagId}`);
  return tags;
}

// --- Goals ---
export async function getGoal(sheetId) {
  return api(`/goals/${sheetId}`);
}

export async function setGoal(sheetId, targetType, targetValue, deadline = null, mode = 'about') {
  return api(`/goals/${sheetId}`, { method: 'PUT', body: { targetType, targetValue, mode, deadline } });
}

export async function removeGoal(sheetId) {
  return api(`/goals/${sheetId}`, { method: 'DELETE' });
}

// --- Settings ---
export async function getSetting(key, defaultValue = null) {
  const result = await api(`/settings/${key}`);
  return result?.value ?? defaultValue;
}

export async function setSetting(key, value) {
  return api(`/settings/${key}`, { method: 'PUT', body: { value } });
}

// --- Search ---
export async function searchSheets(query) {
  return api(`/sheets/search?q=${encodeURIComponent(query)}`);
}

// --- Statistics (pure client-side, no API needed) ---
export function computeStats(text) {
  if (!text || !text.trim()) {
    return { words: 0, chars: 0, charsNoSpaces: 0, sentences: 0, paragraphs: 0, readingTime: '0 min' };
  }
  const words = text.trim().split(/\s+/).length;
  const chars = text.length;
  const charsNoSpaces = text.replace(/\s/g, '').length;
  const sentences = (text.match(/[.!?]+(\s|$)/g) || []).length || (words > 0 ? 1 : 0);
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim()).length || 1;
  const mins = Math.ceil(words / 200);
  const readingTime = mins < 1 ? '< 1 min' : `${mins} min`;
  return { words, chars, charsNoSpaces, sentences, paragraphs, readingTime };
}

// --- Backup / Restore ---
export async function exportAllData() {
  const data = await api('/backup');
  return JSON.stringify(data, null, 2);
}

export async function importAllData(json) {
  const data = JSON.parse(json);
  if (!data.groups || !data.sheets) {
    throw new Error('Invalid backup file');
  }
  return api('/backup', { method: 'POST', body: data });
}

// --- Init ---
export async function initDB() {
  await api('/init', { method: 'POST' });
}
