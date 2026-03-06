'use strict';

const crypto = require('crypto');

function normalizeIpAddress(ip) {
  if (typeof ip !== 'string') return '';
  let normalized = ip.trim().toLowerCase();
  const zoneIndex = normalized.indexOf('%');
  if (zoneIndex !== -1) {
    normalized = normalized.slice(0, zoneIndex);
  }
  if (normalized.startsWith('::ffff:')) {
    normalized = normalized.slice(7);
  }
  return normalized;
}

function isLoopbackAddress(ip, loopbackAddresses) {
  return ip !== '' && loopbackAddresses.has(ip);
}

function collectForwardedAddresses(req) {
  const result = [];

  const pushHeaderValues = (headerValue) => {
    if (typeof headerValue === 'string') {
      headerValue
        .split(',')
        .map((item) => normalizeIpAddress(item))
        .filter(Boolean)
        .forEach((item) => result.push(item));
      return;
    }

    if (Array.isArray(headerValue)) {
      headerValue.forEach((entry) => pushHeaderValues(entry));
    }
  };

  pushHeaderValues(req.headers['x-forwarded-for']);
  pushHeaderValues(req.headers['x-real-ip']);
  return result;
}

function isServerRequest(req, loopbackAddresses) {
  const remoteAddress = normalizeIpAddress(req.socket && req.socket.remoteAddress);
  if (!isLoopbackAddress(remoteAddress, loopbackAddresses)) return false;

  const forwardedAddresses = collectForwardedAddresses(req);
  if (forwardedAddresses.some((address) => !isLoopbackAddress(address, loopbackAddresses))) {
    return false;
  }

  return true;
}

function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};

  return header.split(';').reduce((acc, chunk) => {
    const [rawName, ...rawValueParts] = chunk.split('=');
    const name = rawName ? rawName.trim() : '';
    if (!name) return acc;

    const value = rawValueParts.join('=').trim();
    try {
      acc[name] = decodeURIComponent(value);
    } catch (err) {
      acc[name] = value;
    }
    return acc;
  }, {});
}

function safeCompareStrings(left, right) {
  const leftBuffer = Buffer.from(String(left || ''), 'utf8');
  const rightBuffer = Buffer.from(String(right || ''), 'utf8');

  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function isPrivateIpv4Address(address) {
  if (typeof address !== 'string') return false;
  if (address.startsWith('10.') || address.startsWith('192.168.')) return true;
  if (!address.startsWith('172.')) return false;
  const secondOctet = Number.parseInt(address.split('.')[1], 10);
  return Number.isInteger(secondOctet) && secondOctet >= 16 && secondOctet <= 31;
}

function resolveLocalNetworkIp(os) {
  let privateFallbackAddress = null;
  let fallbackAddress = null;
  const interfaces = os.networkInterfaces();

  for (const entries of Object.values(interfaces)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!entry || entry.family !== 'IPv4' || entry.internal || entry.address.startsWith('169.254.')) continue;
      if (entry.address.startsWith('192.168.')) return entry.address;
      if (!privateFallbackAddress && isPrivateIpv4Address(entry.address)) privateFallbackAddress = entry.address;
      if (!fallbackAddress) fallbackAddress = entry.address;
    }
  }

  return privateFallbackAddress || fallbackAddress;
}

module.exports = {
  normalizeIpAddress,
  isLoopbackAddress,
  collectForwardedAddresses,
  isServerRequest,
  parseCookies,
  safeCompareStrings,
  isPrivateIpv4Address,
  resolveLocalNetworkIp,
};
