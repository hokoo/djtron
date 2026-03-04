'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { AudioCatalogService } = require('../src/catalog/AudioCatalogService');
const { UpdateService } = require('../src/update/UpdateService');

function createCatalogService(overrides = {}) {
  const defaults = {
    collectCatalog: async () => ({ files: ['a.mp3', 'b.mp3'], folders: [] }),
    getAttributesCached: async () => ({ title: 'Test', artist: 'Artist' }),
    buildDisplayName: (attrs, fallback) => attrs.title ? `${attrs.artist} - ${attrs.title}` : fallback,
    normalizePath: (p) => p.replace(/\\/g, '/').replace(/^\/+/, ''),
    safeResolve: (base, rel) => rel.includes('..') ? null : `${base}/${rel}`,
    isAudioFile: (f) => f.endsWith('.mp3') || f.endsWith('.wav'),
    stripExtension: (f) => f.replace(/\.[^.]+$/, ''),
    audioDir: '/audio',
  };
  return new AudioCatalogService({ ...defaults, ...overrides });
}

function createUpdateService(overrides = {}) {
  const mockFs = {
    existsSync: () => false,
    readFileSync: () => '{}',
    writeFileSync: () => {},
    createWriteStream: () => {
      const { PassThrough } = require('node:stream');
      return new PassThrough();
    },
    unlink: (_p, cb) => cb && cb(),
    promises: {
      mkdtemp: async () => '/tmp/test-update',
      readdir: async () => [],
      cp: async () => {},
    },
  };

  const config = {
    currentVersion: overrides.currentVersion || '1.0.0',
    appDir: overrides.appDir || '/app',
    UPDATE_STATE_PATH: '/tmp/test-update-state.json',
    GITHUB_API_URL: 'https://api.github.com/repos/test/test',
    githubToken: null,
    UPDATE_CACHE_WINDOW_MS: 0,
    appVersion: overrides.currentVersion || '1.0.0',
  };

  const deps = {
    fs: mockFs,
    path: require('node:path'),
    os: require('node:os'),
    https: {},
    execFile: (_cmd, _args, cb) => cb && cb(null, '', ''),
  };

  const svc = new UpdateService({ config, deps });

  // Override internal methods for test isolation
  svc._getLatestReleaseInfo = overrides.getLatestReleaseInfo || (async () => ({
    latestVersion: '1.1.0',
    htmlUrl: 'https://github.com/test/releases/1.1.0',
    isPrerelease: false,
    releaseName: 'v1.1.0',
    tarballUrl: 'https://github.com/test/tarball/1.1.0',
  }));
  svc._compareVersions = overrides.compareVersions || ((a, b) => {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      if (pa[i] > pb[i]) return 1;
      if (pa[i] < pb[i]) return -1;
    }
    return 0;
  });
  svc._downloadFile = overrides.downloadFile || (async () => {});
  svc._extractTarball = overrides.extractTarball || (async () => {});
  svc._findExtractedRoot = overrides.findExtractedRoot || (async () => '/tmp/extracted');
  svc._copyReleaseContents = overrides.copyReleaseContents || (async () => {});
  svc._parseBooleanParam = overrides.parseBooleanParam || ((url, name) => url.searchParams.get(name) === 'true');

  return svc;
}

describe('AudioCatalogService', () => {
  it('getCatalog delegates to collectCatalog', async () => {
    const svc = createCatalogService();
    const result = await svc.getCatalog();
    assert.deepEqual(result.files, ['a.mp3', 'b.mp3']);
  });

  it('getAttributes delegates to getAttributesCached', async () => {
    const svc = createCatalogService();
    const result = await svc.getAttributes('test.mp3', '/audio/test.mp3');
    assert.equal(result.title, 'Test');
    assert.equal(result.artist, 'Artist');
  });

  it('buildDisplayName delegates', () => {
    const svc = createCatalogService();
    assert.equal(svc.buildDisplayName({ title: 'Song', artist: 'Band' }, 'fallback'), 'Band - Song');
  });

  it('normalizePath removes backslashes and leading slashes', () => {
    const svc = createCatalogService();
    assert.equal(svc.normalizePath('\\folder\\file.mp3'), 'folder/file.mp3');
  });

  it('resolveAudioPath uses audioDir', () => {
    const svc = createCatalogService();
    assert.equal(svc.resolveAudioPath('sub/file.mp3'), '/audio/sub/file.mp3');
  });

  it('resolveAudioPath rejects path traversal', () => {
    const svc = createCatalogService();
    assert.equal(svc.resolveAudioPath('../etc/passwd'), null);
  });

  it('isAudioFile delegates', () => {
    const svc = createCatalogService();
    assert.equal(svc.isAudioFile('test.mp3'), true);
    assert.equal(svc.isAudioFile('test.txt'), false);
  });

  it('stripExtension delegates', () => {
    const svc = createCatalogService();
    assert.equal(svc.stripExtension('test.mp3'), 'test');
  });
});

describe('UpdateService', () => {
  it('currentVersion returns configured version', () => {
    const svc = createUpdateService();
    assert.equal(svc.currentVersion, '1.0.0');
  });

  it('checkForUpdate returns update info when newer version available', async () => {
    const svc = createUpdateService();
    const url = new URL('http://localhost/api/update/check');
    const result = await svc.checkForUpdate(url);
    assert.equal(result.hasUpdate, true);
    assert.equal(result.currentVersion, '1.0.0');
    assert.equal(result.latestVersion, '1.1.0');
  });

  it('checkForUpdate returns no update when version is current', async () => {
    const svc = createUpdateService({
      getLatestReleaseInfo: async () => ({
        latestVersion: '1.0.0',
        htmlUrl: null,
        isPrerelease: false,
        releaseName: 'v1.0.0',
      }),
    });
    const url = new URL('http://localhost/api/update/check');
    const result = await svc.checkForUpdate(url);
    assert.equal(result.hasUpdate, false);
  });

  it('applyUpdate returns 409 when update already in progress', async () => {
    const svc = createUpdateService({
      downloadFile: () => new Promise(() => {}), // never resolves
    });
    const url = new URL('http://localhost/api/update/apply');
    // Start first update (don't await — it won't finish)
    svc.applyUpdate(url);
    // Second attempt should get 409
    const result = await svc.applyUpdate(url);
    assert.equal(result.status, 409);
  });

  it('applyUpdate returns no-update message when version is current', async () => {
    const svc = createUpdateService({
      getLatestReleaseInfo: async () => ({
        latestVersion: '1.0.0',
        tarballUrl: null,
      }),
    });
    const url = new URL('http://localhost/api/update/apply');
    const result = await svc.applyUpdate(url);
    assert.equal(result.status, 200);
    assert.ok(result.body.message.includes('последняя версия'));
  });

  it('applyUpdate succeeds with newer version', async () => {
    let copied = false;
    const svc = createUpdateService({
      copyReleaseContents: async () => { copied = true; },
    });
    const url = new URL('http://localhost/api/update/apply');
    const result = await svc.applyUpdate(url);
    assert.equal(result.status, 200);
    assert.ok(result.body.message.includes('установлено'));
    assert.equal(copied, true);
    assert.equal(svc.updateInProgress, false);
  });

  it('applyUpdate resets updateInProgress on error', async () => {
    const svc = createUpdateService({
      downloadFile: async () => { throw new Error('network error'); },
    });
    const url = new URL('http://localhost/api/update/apply');
    await assert.rejects(() => svc.applyUpdate(url), /network error/);
    assert.equal(svc.updateInProgress, false);
  });
});
