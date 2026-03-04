// public/modules/utils.js — generic utility helpers

export function trackKey(file, basePath = '/audio') {
  return `${basePath}|${file}`;
}

export function getOrCreateSet(map, key) {
  const existing = map.get(key);
  if (existing) return existing;
  const created = new Set();
  map.set(key, created);
  return created;
}

export function addToMultiMap(map, key, value) {
  getOrCreateSet(map, key).add(value);
}

export function getFirstFromSet(values) {
  if (!values || !values.size) return null;
  return values.values().next().value || null;
}
