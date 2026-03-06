'use strict';

const path = require('path');

const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.flac']);

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAudioFile(filenameOrPath) {
  return AUDIO_EXTENSIONS.has(path.extname(filenameOrPath).toLowerCase());
}

module.exports = { delay, isAudioFile, AUDIO_EXTENSIONS };
