'use strict';

/**
 * AudioCatalogService — facade for audio catalog and metadata operations.
 *
 * Encapsulates catalog collection, attribute extraction and caching
 * so HTTP handlers never touch internals directly.
 */
class AudioCatalogService {
  /**
   * @param {object} deps
   * @param {function} deps.collectCatalog - () => Promise<{ files, folders }>
   * @param {function} deps.getAttributesCached - (relFile, absFile, stat) => Promise<{ title, artist }>
   * @param {function} deps.buildDisplayName - (attributes, fallback) => string
   * @param {function} deps.normalizePath - (relativePath) => string
   * @param {function} deps.safeResolve - (baseDir, relPath) => string|null
   * @param {function} deps.isAudioFile - (filename) => boolean
   * @param {function} deps.stripExtension - (filename) => string
   * @param {string} deps.audioDir - resolved audio directory path
   */
  constructor(deps) {
    this._collectCatalog = deps.collectCatalog;
    this._getAttributesCached = deps.getAttributesCached;
    this._buildDisplayName = deps.buildDisplayName;
    this._normalizePath = deps.normalizePath;
    this._safeResolve = deps.safeResolve;
    this._isAudioFile = deps.isAudioFile;
    this._stripExtension = deps.stripExtension;
    this._audioDir = deps.audioDir;
  }

  /** Collect the full audio catalog (files + folders). */
  async getCatalog() {
    return this._collectCatalog();
  }

  /**
   * Get cached audio attributes for a file.
   * @param {string} relativeFile
   * @param {string} absoluteFile
   * @param {object} [stat]
   * @returns {Promise<{ title: string, artist: string }>}
   */
  async getAttributes(relativeFile, absoluteFile, stat) {
    return this._getAttributesCached(relativeFile, absoluteFile, stat);
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
}

module.exports = { AudioCatalogService };
