'use strict';

const path = require('path');
const fs = require('fs');
const { extractAudioAttributes, normalizeAudioRelativePath, buildAudioAttributeDisplayName, stripFileExtension } = require('../audio/metadata');
const { isAudioFile } = require('../utils');
const { safeResolve } = require('../static/serve');

const DEFAULT_AUDIO_TAG_SCAN_BYTES = 256 * 1024;

/**
 * AudioCatalogService — facade for audio catalog and metadata operations.
 *
 * Encapsulates catalog collection, attribute extraction and caching
 * so HTTP handlers never touch internals directly.
 */
class AudioCatalogService {
  /**
   * @param {object} deps
   * @param {function} [deps.collectCatalog] - () => Promise<{ files, folders }> (override for testing)
   * @param {function} [deps.getAttributesCached] - (relFile, absFile, stat) => Promise<{ title, artist }> (override for testing)
   * @param {function} [deps.buildDisplayName] - (attributes, fallback) => string
   * @param {function} [deps.normalizePath] - (relativePath) => string
   * @param {function} [deps.safeResolve] - (baseDir, relPath) => string|null
   * @param {function} [deps.isAudioFile] - (filename) => boolean
   * @param {function} [deps.stripExtension] - (filename) => string
   * @param {string} deps.audioDir - resolved audio directory path
   * @param {number} [deps.audioTagScanBytes] - bytes to scan for ID3 tags
   */
  constructor(deps) {
    this._buildDisplayName = deps.buildDisplayName || buildAudioAttributeDisplayName;
    this._normalizePath = deps.normalizePath || normalizeAudioRelativePath;
    this._safeResolve = deps.safeResolve || safeResolve;
    this._isAudioFile = deps.isAudioFile || isAudioFile;
    this._stripExtension = deps.stripExtension || stripFileExtension;
    this._audioDir = deps.audioDir;
    this._audioTagScanBytes = deps.audioTagScanBytes || DEFAULT_AUDIO_TAG_SCAN_BYTES;
    this._cache = new Map();

    // Allow injection for testing, fall back to built-in implementations
    this._collectCatalogFn = deps.collectCatalog || null;
    this._getAttributesCachedFn = deps.getAttributesCached || null;
  }

  /** Collect the full audio catalog (files + folders). */
  async getCatalog() {
    if (this._collectCatalogFn) return this._collectCatalogFn();
    return this._collectCatalogInternal();
  }

  /**
   * Get cached audio attributes for a file.
   * @param {string} relativeFile
   * @param {string} absoluteFile
   * @param {object} [stat]
   * @returns {Promise<{ title: string, artist: string }>}
   */
  async getAttributes(relativeFile, absoluteFile, stat) {
    if (this._getAttributesCachedFn) return this._getAttributesCachedFn(relativeFile, absoluteFile, stat);
    return this._getAttributesCachedInternal(relativeFile, absoluteFile, stat);
  }

  /**
   * Build a display name from attributes with fallback.
   * @param {{ title: string, artist: string }} attributes
   * @param {string} fallbackName
   * @returns {string}
   */
  buildDisplayName(attributes, fallbackName) {
    return this._buildDisplayName(attributes, fallbackName);
  }

  /** Normalize an audio-relative path (forward slashes, no leading slash). */
  normalizePath(relativePath) {
    return this._normalizePath(relativePath);
  }

  /**
   * Safely resolve a relative path within the audio directory.
   * @returns {string|null} resolved absolute path, or null if path escapes audio dir
   */
  resolveAudioPath(relativePath) {
    return this._safeResolve(this._audioDir, relativePath);
  }

  /** Check if a filename is an audio file. */
  isAudioFile(filename) {
    return this._isAudioFile(filename);
  }

  /** Strip file extension from a filename. */
  stripExtension(filename) {
    return this._stripExtension(filename);
  }

  /** @private */
  async _getAttributesCachedInternal(relativeFile, absoluteFile, stat) {
    const normalizedRelative = this._normalizePath(relativeFile || '');
    if (!normalizedRelative) {
      return { title: '', artist: '' };
    }

    const fileStat = stat || (await fs.promises.stat(absoluteFile));
    const cached = this._cache.get(normalizedRelative);
    if (cached && cached.mtimeMs === fileStat.mtimeMs && cached.size === fileStat.size) {
      return cached.attributes;
    }

    const attributes = await extractAudioAttributes(absoluteFile, fileStat, { audioTagScanBytes: this._audioTagScanBytes });
    this._cache.set(normalizedRelative, {
      mtimeMs: fileStat.mtimeMs,
      size: fileStat.size,
      attributes,
    });

    return attributes;
  }

  /** @private */
  async _collectCatalogInternal() {
    const audioDir = this._audioDir;
    const normalizePath = this._normalizePath;
    const isAudio = this._isAudioFile;
    const files = [];
    const folders = [];

    const walk = async (absoluteDir, relativeDir = '') => {
      let entries;
      try {
        entries = await fs.promises.readdir(absoluteDir, { withFileTypes: true });
      } catch (err) {
        if (err.code === 'ENOENT') return;
        throw err;
      }

      const sortedEntries = entries.slice().sort((left, right) => left.name.localeCompare(right.name, 'ru'));
      const folderFiles = [];
      const childFolders = [];

      for (const entry of sortedEntries) {
        if (entry.name.startsWith('.')) continue;

        const childRelative = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
        const normalizedChildRelative = normalizePath(childRelative);

        if (entry.isDirectory()) {
          childFolders.push({ absolute: path.join(absoluteDir, entry.name), relative: normalizedChildRelative });
          continue;
        }

        if (!entry.isFile() || !isAudio(entry.name)) continue;
        files.push(normalizedChildRelative);
        if (relativeDir) {
          folderFiles.push(normalizedChildRelative);
        }
      }

      if (relativeDir && folderFiles.length) {
        const normalizedKey = normalizePath(relativeDir);
        const folderName = path.basename(normalizedKey) || normalizedKey;
        folders.push({
          key: normalizedKey,
          name: folderName,
          files: folderFiles,
        });
      }

      for (const childFolder of childFolders) {
        await walk(childFolder.absolute, childFolder.relative);
      }
    };

    await walk(audioDir, '');

    return {
      files,
      folders: folders.sort((left, right) => left.key.localeCompare(right.key, 'ru')),
    };
  }
}

module.exports = { AudioCatalogService };
