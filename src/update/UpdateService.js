'use strict';

const path = require('node:path');
const os = require('node:os');

/**
 * UpdateService — facade for application update check and apply operations.
 *
 * Encapsulates version comparison, release fetching, caching, and update
 * application so HTTP handlers stay thin.
 */
class UpdateService {
  /**
   * @param {object} deps
   * @param {string} deps.currentVersion - appVersion
   * @param {function} deps.getLatestReleaseInfo - (version, allowPrerelease) => Promise<release>
   * @param {function} deps.compareVersions - (a, b) => number
   * @param {function} deps.downloadFile - (url, dest) => Promise<void>
   * @param {function} deps.extractTarball - (archivePath, targetDir) => Promise<void>
   * @param {function} deps.findExtractedRoot - (tempDir) => Promise<string>
   * @param {function} deps.copyReleaseContents - (sourceDir, targetDir) => Promise<void>
   * @param {string} deps.appDir - __dirname of the application
   * @param {function} deps.parseBooleanParam - (url, name) => boolean
   */
  constructor(deps) {
    this._currentVersion = deps.currentVersion;
    this._getLatestReleaseInfo = deps.getLatestReleaseInfo;
    this._compareVersions = deps.compareVersions;
    this._downloadFile = deps.downloadFile;
    this._extractTarball = deps.extractTarball;
    this._findExtractedRoot = deps.findExtractedRoot;
    this._copyReleaseContents = deps.copyReleaseContents;
    this._appDir = deps.appDir;
    this._parseBooleanParam = deps.parseBooleanParam;
    this._updateInProgress = false;
  }

  /** Current application version. */
  get currentVersion() {
    return this._currentVersion;
  }

  /** Whether an update is currently in progress. */
  get updateInProgress() {
    return this._updateInProgress;
  }

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

      const fs = require('node:fs');
      const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'djtron-update-'));
      const archivePath = path.join(tempDir, 'release.tar.gz');

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
