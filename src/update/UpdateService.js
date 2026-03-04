'use strict';

const { promisify } = require('node:util');
const { pipeline } = require('node:stream');

/**
 * UpdateService — self-contained service for application update check and apply.
 *
 * Encapsulates GitHub API access, version comparison, release fetching, caching,
 * update state persistence, and update application so HTTP handlers stay thin.
 *
 * @param {object} options
 * @param {object} options.config
 * @param {string} options.config.appDir - application root directory
 * @param {string} options.config.currentVersion - current application version
 * @param {string} options.config.UPDATE_STATE_PATH - path to update-state.json
 * @param {string} options.config.GITHUB_API_URL - GitHub API base URL for the repo
 * @param {string|null} options.config.githubToken - optional GitHub token
 * @param {number} options.config.UPDATE_CACHE_WINDOW_MS - cache window in ms
 * @param {string} options.config.appVersion - application version string
 * @param {object} options.deps - external dependencies
 * @param {object} options.deps.fs - fs module
 * @param {object} options.deps.path - path module
 * @param {object} options.deps.os - os module
 * @param {object} options.deps.https - https module
 * @param {function} options.deps.execFile - child_process.execFile
 */
class UpdateService {
  constructor({ config = {}, deps = {} } = {}) {
    this._appDir = config.appDir;
    this._currentVersion = config.currentVersion;
    this._UPDATE_STATE_PATH = config.UPDATE_STATE_PATH;
    this._GITHUB_API_URL = config.GITHUB_API_URL;
    this._githubToken = config.githubToken || null;
    this._UPDATE_CACHE_WINDOW_MS = typeof config.UPDATE_CACHE_WINDOW_MS === 'number' ? config.UPDATE_CACHE_WINDOW_MS : 0;
    this._appVersion = config.appVersion;

    this._fs = deps.fs || require('node:fs');
    this._path = deps.path || require('node:path');
    this._os = deps.os || require('node:os');
    this._https = deps.https || require('node:https');
    this._execFile = deps.execFile || require('node:child_process').execFile;

    this._pipelineAsync = promisify(pipeline);
    this._execFileAsync = promisify(this._execFile);

    this._updateInProgress = false;

    this._githubCache = {
      latestRelease: { etag: null, data: null },
      releasesList: { etag: null, data: null },
    };

    const persistedState = this._loadPersistedUpdateState();
    this._updateCheckCache = {
      stable: { lastChecked: persistedState.stable.lastChecked, result: persistedState.stable.result },
      prerelease: { lastChecked: persistedState.prerelease.lastChecked, result: persistedState.prerelease.result },
    };
  }

  /** Current application version. */
  get currentVersion() {
    return this._currentVersion;
  }

  /** Whether an update is currently in progress. */
  get updateInProgress() {
    return this._updateInProgress;
  }

  // ---------------------------------------------------------------------------
  // Update state persistence
  // ---------------------------------------------------------------------------

  _getDefaultUpdateState() {
    return {
      stable: { lastChecked: 0, result: null },
      prerelease: { lastChecked: 0, result: null },
    };
  }

  _sanitizeCachedResult(result) {
    if (!result || typeof result !== 'object') return null;

    const clean = {
      latestVersion: typeof result.latestVersion === 'string' ? result.latestVersion : null,
      tarballUrl: typeof result.tarballUrl === 'string' ? result.tarballUrl : null,
      htmlUrl: typeof result.htmlUrl === 'string' ? result.htmlUrl : null,
      isPrerelease: Boolean(result.isPrerelease),
      releaseName: typeof result.releaseName === 'string' ? result.releaseName : null,
    };

    if (!clean.latestVersion && !clean.tarballUrl && !clean.htmlUrl && !clean.releaseName) {
      return null;
    }

    return clean;
  }

  _loadPersistedUpdateState() {
    try {
      if (!this._fs.existsSync(this._UPDATE_STATE_PATH)) {
        return this._getDefaultUpdateState();
      }

      const raw = this._fs.readFileSync(this._UPDATE_STATE_PATH, 'utf8');
      const parsed = JSON.parse(raw);

      const state = this._getDefaultUpdateState();

      ['stable', 'prerelease'].forEach((key) => {
        if (!parsed[key] || typeof parsed[key] !== 'object') return;

        const lastChecked = Number(parsed[key].lastChecked);
        if (Number.isFinite(lastChecked) && lastChecked > 0) {
          state[key].lastChecked = lastChecked;
        }

        const cachedResult = this._sanitizeCachedResult(parsed[key].result);
        if (cachedResult) {
          state[key].result = cachedResult;
        }
      });

      return state;
    } catch (err) {
      console.error('Failed to load update state cache', err);
      return this._getDefaultUpdateState();
    }
  }

  _persistUpdateState(state) {
    try {
      this._fs.writeFileSync(this._UPDATE_STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
    } catch (err) {
      console.error('Failed to persist update state cache', err);
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  _parseBooleanParam(url, name) {
    const value = url.searchParams.get(name);
    if (value === null) return false;
    return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
  }

  _normalizeVersion(version) {
    if (typeof version !== 'string') return null;
    return version.replace(/^v/i, '').trim();
  }

  _compareVersions(a, b) {
    const left = this._normalizeVersion(a);
    const right = this._normalizeVersion(b);

    if (!left || !right) return 0;

    const leftParts = left.split('.').map((p) => parseInt(p, 10) || 0);
    const rightParts = right.split('.').map((p) => parseInt(p, 10) || 0);
    const maxLen = Math.max(leftParts.length, rightParts.length);

    for (let i = 0; i < maxLen; i += 1) {
      const l = leftParts[i] || 0;
      const r = rightParts[i] || 0;
      if (l > r) return 1;
      if (l < r) return -1;
    }

    return 0;
  }

  _delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  _parseReleaseVersion(release) {
    if (!release) return null;
    const candidates = [release.tag_name, release.name];

    for (const value of candidates) {
      if (typeof value !== 'string') continue;
      const match = /v(\d+(?:\.\d+)*)/i.exec(value);
      if (match) return match[1];
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // GitHub API
  // ---------------------------------------------------------------------------

  _computeRateLimitDelay(headers, fallbackMs) {
    const retryAfter = headers['retry-after'];
    if (retryAfter) {
      const retrySeconds = parseFloat(retryAfter);
      if (Number.isFinite(retrySeconds) && retrySeconds > 0) {
        return retrySeconds * 1000;
      }
    }

    const remaining = headers['x-ratelimit-remaining'];
    const reset = headers['x-ratelimit-reset'];

    if (remaining === '0' && reset) {
      const resetMs = parseInt(reset, 10) * 1000 - Date.now();
      if (Number.isFinite(resetMs) && resetMs > 0) {
        return resetMs;
      }
    }

    return fallbackMs;
  }

  _fetchGithubJsonWithETag(url, cacheEntry, attempt = 1, backoffMs = 1000) {
    const headers = { 'User-Agent': 'djtron-updater', Accept: 'application/vnd.github+json' };
    if (this._githubToken) {
      headers.Authorization = `Bearer ${this._githubToken}`;
    }
    if (cacheEntry && cacheEntry.etag) {
      headers['If-None-Match'] = cacheEntry.etag;
    }

    const performRequest = () =>
      new Promise((resolve, reject) => {
        const request = this._https.get(url, { headers }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            this._fetchGithubJsonWithETag(res.headers.location, cacheEntry, attempt, backoffMs).then(resolve).catch(reject);
            return;
          }

          if (res.statusCode === 304) {
            res.resume();
            if (cacheEntry && cacheEntry.data) {
              resolve({ data: cacheEntry.data, etag: cacheEntry.etag, fromCache: true });
            } else {
              reject(new Error('Получен 304 без сохраненных данных'));
            }
            return;
          }

          if (res.statusCode === 403 || res.statusCode === 429) {
            const waitMs = this._computeRateLimitDelay(res.headers, backoffMs);
            res.resume();
            if (attempt < 3) {
              this._delay(waitMs)
                .then(() => this._fetchGithubJsonWithETag(url, cacheEntry, attempt + 1, Math.min(backoffMs * 2, 16000)))
                .then(resolve)
                .catch(reject);
              return;
            }
            reject(new Error('Превышены лимиты GitHub API, попробуйте позже'));
            return;
          }

          if (res.statusCode !== 200) {
            reject(new Error(`GitHub API responded with status ${res.statusCode}`));
            res.resume();
            return;
          }

          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => {
            try {
              const parsed = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
              resolve({ data: parsed, etag: res.headers.etag || null, fromCache: false });
            } catch (err) {
              reject(err);
            }
          });
        });

        request.on('error', reject);
      });

    return performRequest();
  }

  async _fetchLatestRelease() {
    const result = await this._fetchGithubJsonWithETag(
      `${this._GITHUB_API_URL}/releases/latest`,
      this._githubCache.latestRelease,
    );
    this._githubCache.latestRelease.etag = result.etag || this._githubCache.latestRelease.etag;
    this._githubCache.latestRelease.data = result.data || this._githubCache.latestRelease.data;
    return this._githubCache.latestRelease.data;
  }

  async _fetchLatestPrerelease() {
    const result = await this._fetchGithubJsonWithETag(
      `${this._GITHUB_API_URL}/releases?per_page=20`,
      this._githubCache.releasesList,
    );
    this._githubCache.releasesList.etag = result.etag || this._githubCache.releasesList.etag;
    this._githubCache.releasesList.data = result.data || this._githubCache.releasesList.data;

    const releases = result.data;
    if (!Array.isArray(releases)) return null;

    return releases.find((rel) => rel && !rel.draft && rel.prerelease) || null;
  }

  async _getLatestReleaseInfo(currentVersion, allowPrerelease = false) {
    const cacheKey = allowPrerelease ? 'prerelease' : 'stable';
    const cacheEntry = this._updateCheckCache[cacheKey];
    const now = Date.now();

    if (cacheEntry.result && this._UPDATE_CACHE_WINDOW_MS > 0 && now - cacheEntry.lastChecked < this._UPDATE_CACHE_WINDOW_MS) {
      return cacheEntry.result;
    }

    const release = await this._fetchLatestRelease();
    const releaseVersion = this._parseReleaseVersion(release);

    let latest = {
      latestVersion: releaseVersion,
      tarballUrl: release && release.tarball_url,
      htmlUrl: release && release.html_url,
      isPrerelease: false,
      releaseName: release && release.name,
    };

    if (allowPrerelease) {
      const prerelease = await this._fetchLatestPrerelease();
      const prereleaseVersion = this._parseReleaseVersion(prerelease);

      if (prerelease && prereleaseVersion && this._compareVersions(prereleaseVersion, currentVersion) > 0) {
        latest = {
          latestVersion: prereleaseVersion,
          tarballUrl: prerelease && prerelease.tarball_url,
          htmlUrl: prerelease && prerelease.html_url,
          isPrerelease: true,
          releaseName: prerelease && prerelease.name,
        };
      }
    }

    cacheEntry.lastChecked = now;
    cacheEntry.result = latest;
    this._persistUpdateState(this._updateCheckCache);

    return latest;
  }

  // ---------------------------------------------------------------------------
  // File operations
  // ---------------------------------------------------------------------------

  _downloadFile(url, destination) {
    return new Promise((resolve, reject) => {
      const file = this._fs.createWriteStream(destination);

      const handleResponse = (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          this._https.get(res.headers.location, { headers: { 'User-Agent': 'djtron-updater' } }, handleResponse).on(
            'error',
            reject
          );
          return;
        }

        if (res.statusCode !== 200) {
          reject(new Error(`Download failed with status ${res.statusCode}`));
          res.resume();
          return;
        }

        this._pipelineAsync(res, file)
          .then(resolve)
          .catch((err) => {
            this._fs.unlink(destination, () => reject(err));
          });
      };

      this._https
        .get(url, { headers: { 'User-Agent': 'djtron-updater' } }, handleResponse)
        .on('error', (err) => {
          this._fs.unlink(destination, () => reject(err));
        });
    });
  }

  async _extractTarball(archivePath, targetDir) {
    await this._execFileAsync('tar', ['-xzf', archivePath, '-C', targetDir]);
  }

  async _findExtractedRoot(tempDir) {
    const entries = await this._fs.promises.readdir(tempDir, { withFileTypes: true });
    const folder = entries.find((entry) => entry.isDirectory());
    if (!folder) {
      throw new Error('Не удалось найти содержимое распакованного архива');
    }
    return this._path.join(tempDir, folder.name);
  }

  async _copyReleaseContents(sourceDir, targetDir) {
    await this._fs.promises.cp(sourceDir, targetDir, { recursive: true, force: true });
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Check for available updates.
   * @param {URL} url - parsed request URL (for allowPrerelease param)
   * @returns {Promise<object>} update check result
   */
  async checkForUpdate(url) {
    const allowPrerelease = this._parseBooleanParam(url, 'allowPrerelease');
    const { latestVersion, htmlUrl, isPrerelease, releaseName } = await this._getLatestReleaseInfo(
      this._currentVersion,
      allowPrerelease,
    );
    const comparableLatest = latestVersion || null;
    const hasUpdate = comparableLatest ? this._compareVersions(comparableLatest, this._currentVersion) > 0 : false;

    return {
      currentVersion: this._currentVersion,
      latestVersion: comparableLatest,
      hasUpdate,
      releaseUrl: htmlUrl || null,
      isPrerelease: Boolean(isPrerelease),
      releaseName: releaseName || null,
    };
  }

  /**
   * Apply an available update.
   * @param {URL} url - parsed request URL (for allowPrerelease param)
   * @returns {Promise<{ status: number, body: object }>}
   */
  async applyUpdate(url) {
    if (this._updateInProgress) {
      return { status: 409, body: { message: 'Обновление уже выполняется' } };
    }

    this._updateInProgress = true;

    try {
      const allowPrerelease = this._parseBooleanParam(url, 'allowPrerelease');
      const { latestVersion, tarballUrl } = await this._getLatestReleaseInfo(
        this._currentVersion,
        allowPrerelease,
      );
      const comparableLatest = latestVersion || null;
      const hasUpdate = comparableLatest ? this._compareVersions(comparableLatest, this._currentVersion) > 0 : false;

      if (!hasUpdate) {
        return { status: 200, body: { message: 'Установлена последняя версия приложения' } };
      }

      if (!tarballUrl) {
        throw new Error('Не удалось найти архив релиза для загрузки');
      }

      const tempDir = await this._fs.promises.mkdtemp(this._path.join(this._os.tmpdir(), 'djtron-update-'));
      const archivePath = this._path.join(tempDir, 'release.tar.gz');

      await this._downloadFile(tarballUrl, archivePath);
      await this._extractTarball(archivePath, tempDir);
      const extractedRoot = await this._findExtractedRoot(tempDir);
      await this._copyReleaseContents(extractedRoot, this._appDir);

      return { status: 200, body: { message: 'Обновление установлено. Приложение будет закрыто.' } };
    } finally {
      this._updateInProgress = false;
    }
  }
}

module.exports = { UpdateService };
