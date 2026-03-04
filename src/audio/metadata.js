'use strict';

const path = require('path');
const fs = require('fs');

function normalizeAudioRelativePath(relativePath) {
  return relativePath
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/');
}

function stripFileExtension(fileName) {
  if (typeof fileName !== 'string') return '';
  const extension = path.extname(fileName);
  if (!extension) return fileName;
  return fileName.slice(0, -extension.length);
}

function sanitizeAudioAttributeText(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/\u0000+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180);
}

function decodeUtf16Be(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 2) return '';
  const evenLength = buffer.length - (buffer.length % 2);
  if (evenLength <= 0) return '';

  const swapped = Buffer.allocUnsafe(evenLength);
  for (let index = 0; index < evenLength; index += 2) {
    swapped[index] = buffer[index + 1];
    swapped[index + 1] = buffer[index];
  }
  return swapped.toString('utf16le');
}

function decodeId3TextFrame(frameData) {
  if (!Buffer.isBuffer(frameData) || frameData.length <= 1) return '';

  const encoding = frameData[0];
  const payload = frameData.subarray(1);
  let decoded = '';

  switch (encoding) {
    case 0:
      decoded = payload.toString('latin1');
      break;
    case 1:
      if (payload.length >= 2 && payload[0] === 0xfe && payload[1] === 0xff) {
        decoded = decodeUtf16Be(payload.subarray(2));
      } else if (payload.length >= 2 && payload[0] === 0xff && payload[1] === 0xfe) {
        decoded = payload.subarray(2).toString('utf16le');
      } else {
        decoded = payload.toString('utf16le');
      }
      break;
    case 2:
      decoded = decodeUtf16Be(payload);
      break;
    case 3:
      decoded = payload.toString('utf8');
      break;
    default:
      decoded = payload.toString('utf8');
      break;
  }

  const firstToken = decoded
    .split(/\u0000+/)
    .map((part) => sanitizeAudioAttributeText(part))
    .find(Boolean);
  return firstToken || sanitizeAudioAttributeText(decoded);
}

function readSynchsafeInt(buffer, offset) {
  if (!Buffer.isBuffer(buffer) || offset < 0 || offset + 4 > buffer.length) return 0;
  return (
    ((buffer[offset] & 0x7f) << 21) |
    ((buffer[offset + 1] & 0x7f) << 14) |
    ((buffer[offset + 2] & 0x7f) << 7) |
    (buffer[offset + 3] & 0x7f)
  );
}

function parseId3v2Attributes(buffer) {
  const empty = { title: '', artist: '' };
  if (!Buffer.isBuffer(buffer) || buffer.length < 10) return empty;
  if (buffer.toString('latin1', 0, 3) !== 'ID3') return empty;

  const versionMajor = buffer[3];
  const flags = buffer[5];
  const hasFooter = (flags & 0x10) === 0x10;
  const declaredTagSize = readSynchsafeInt(buffer, 6);
  const maxTagSize = buffer.length - 10;
  const tagBodySize = Math.max(0, Math.min(declaredTagSize, maxTagSize));
  const totalTagBytes = 10 + tagBodySize + (hasFooter ? 10 : 0);
  const maxOffset = Math.min(totalTagBytes, buffer.length);

  let cursor = 10;
  let title = '';
  let artist = '';

  while (cursor + 10 <= maxOffset) {
    if (
      buffer[cursor] === 0 &&
      buffer[cursor + 1] === 0 &&
      buffer[cursor + 2] === 0 &&
      buffer[cursor + 3] === 0
    ) {
      break;
    }

    const frameId = buffer.toString('latin1', cursor, cursor + 4);
    if (!/^[A-Z0-9]{4}$/.test(frameId)) {
      break;
    }

    const frameSize = versionMajor === 4 ? readSynchsafeInt(buffer, cursor + 4) : buffer.readUInt32BE(cursor + 4);
    if (!Number.isFinite(frameSize) || frameSize <= 0) {
      cursor += 10;
      continue;
    }

    const frameStart = cursor + 10;
    const frameEnd = frameStart + frameSize;
    if (frameEnd > maxOffset || frameStart >= frameEnd) {
      break;
    }

    const frameData = buffer.subarray(frameStart, frameEnd);
    if (frameId === 'TIT2' && !title) {
      title = decodeId3TextFrame(frameData);
    } else if (frameId === 'TPE1' && !artist) {
      artist = decodeId3TextFrame(frameData);
    }

    if (title && artist) {
      break;
    }

    cursor = frameEnd;
  }

  return {
    title: sanitizeAudioAttributeText(title),
    artist: sanitizeAudioAttributeText(artist),
  };
}

function parseId3v1Attributes(buffer) {
  const empty = { title: '', artist: '' };
  if (!Buffer.isBuffer(buffer) || buffer.length < 128) return empty;
  if (buffer.toString('latin1', 0, 3) !== 'TAG') return empty;

  return {
    title: sanitizeAudioAttributeText(buffer.toString('latin1', 3, 33)),
    artist: sanitizeAudioAttributeText(buffer.toString('latin1', 33, 63)),
  };
}

async function readFileSlice(filePath, start, length) {
  const safeLength = Number.isFinite(length) ? Math.max(0, Math.floor(length)) : 0;
  if (safeLength <= 0) return Buffer.alloc(0);

  const handle = await fs.promises.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(safeLength);
    const safeStart = Number.isFinite(start) ? Math.max(0, Math.floor(start)) : 0;
    const { bytesRead } = await handle.read(buffer, 0, safeLength, safeStart);
    return bytesRead === safeLength ? buffer : buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function extractAudioAttributes(filePath, stat, { audioTagScanBytes }) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension !== '.mp3') {
    return { title: '', artist: '' };
  }

  const size = Number.isFinite(stat && stat.size) ? Math.max(0, stat.size) : 0;
  let result = { title: '', artist: '' };

  if (size > 0) {
    const headLength = Math.min(size, audioTagScanBytes);
    const head = await readFileSlice(filePath, 0, headLength);
    result = parseId3v2Attributes(head);
  }

  if ((!result.title || !result.artist) && size >= 128) {
    const tail = await readFileSlice(filePath, size - 128, 128);
    const id3v1 = parseId3v1Attributes(tail);
    if (!result.title && id3v1.title) {
      result.title = id3v1.title;
    }
    if (!result.artist && id3v1.artist) {
      result.artist = id3v1.artist;
    }
  }

  return {
    title: sanitizeAudioAttributeText(result.title),
    artist: sanitizeAudioAttributeText(result.artist),
  };
}

function buildAudioAttributeDisplayName(attributes, fallbackName) {
  const title = sanitizeAudioAttributeText(attributes && attributes.title);
  const artist = sanitizeAudioAttributeText(attributes && attributes.artist);
  if (title && artist) return `${artist} - ${title}`;
  return title || artist || fallbackName;
}

module.exports = {
  normalizeAudioRelativePath,
  stripFileExtension,
  sanitizeAudioAttributeText,
  decodeUtf16Be,
  decodeId3TextFrame,
  readSynchsafeInt,
  parseId3v2Attributes,
  parseId3v1Attributes,
  readFileSlice,
  extractAudioAttributes,
  buildAudioAttributeDisplayName,
};
