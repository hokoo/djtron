'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { ConfigManager } = require('../src/config/ConfigManager');

let tempDir;

beforeEach(async () => {
  tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cfg-test-'));
});

afterEach(async () => {
  await fs.promises.rm(tempDir, { recursive: true, force: true });
});

describe('ConfigManager', () => {
  describe('loadEnvFile', () => {
    it('loads .env into process.env without overwriting', () => {
      fs.writeFileSync(path.join(tempDir, '.env'), 'TEST_CFG_KEY=hello\n');
      const cm = new ConfigManager({ appDir: tempDir });
      cm.loadEnvFile();
      assert.equal(process.env.TEST_CFG_KEY, 'hello');
      delete process.env.TEST_CFG_KEY;
    });

    it('does not overwrite existing env vars', () => {
      process.env.TEST_CFG_EXISTING = 'original';
      fs.writeFileSync(path.join(tempDir, '.env'), 'TEST_CFG_EXISTING=overwritten\n');
      const cm = new ConfigManager({ appDir: tempDir });
      cm.loadEnvFile();
      assert.equal(process.env.TEST_CFG_EXISTING, 'original');
      delete process.env.TEST_CFG_EXISTING;
    });

    it('handles missing .env gracefully', () => {
      const cm = new ConfigManager({ appDir: tempDir });
      cm.loadEnvFile(); // no throw
    });

    it('strips quotes from values', () => {
      fs.writeFileSync(path.join(tempDir, '.env'), 'TEST_CFG_QUOTED="quoted_val"\n');
      const cm = new ConfigManager({ appDir: tempDir });
      cm.loadEnvFile();
      assert.equal(process.env.TEST_CFG_QUOTED, 'quoted_val');
      delete process.env.TEST_CFG_QUOTED;
    });
  });

  describe('loadRootConfig', () => {
    it('parses extra.conf with key=value and key:value', () => {
      fs.writeFileSync(path.join(tempDir, 'extra.conf'), 'port=8080\ndsp_enabled: true\n');
      const cm = new ConfigManager({ appDir: tempDir });
      const config = cm.loadRootConfig();
      assert.equal(config.port, '8080');
      assert.equal(config.dsp_enabled, 'true');
    });

    it('returns empty object when no config file', () => {
      const cm = new ConfigManager({ appDir: tempDir });
      assert.deepEqual(cm.loadRootConfig(), {});
    });

    it('skips comments and empty lines', () => {
      fs.writeFileSync(path.join(tempDir, 'extra.conf'), '# comment\n\nkey=val\n');
      const cm = new ConfigManager({ appDir: tempDir });
      const config = cm.loadRootConfig();
      assert.equal(config.key, 'val');
      assert.equal(Object.keys(config).length, 1);
    });

    it('caches result on subsequent calls', () => {
      fs.writeFileSync(path.join(tempDir, 'extra.conf'), 'a=1\n');
      const cm = new ConfigManager({ appDir: tempDir });
      const first = cm.loadRootConfig();
      fs.writeFileSync(path.join(tempDir, 'extra.conf'), 'a=2\n');
      const second = cm.loadRootConfig();
      assert.equal(first, second); // same reference
      assert.equal(second.a, '1');
    });
  });

  describe('pick', () => {
    it('returns first matching key', () => {
      fs.writeFileSync(path.join(tempDir, 'extra.conf'), 'alt_key=found\n');
      const cm = new ConfigManager({ appDir: tempDir });
      cm.loadRootConfig();
      assert.equal(cm.pick(['missing', 'alt_key']), 'found');
    });

    it('returns undefined when no key matches', () => {
      fs.writeFileSync(path.join(tempDir, 'extra.conf'), 'other=val\n');
      const cm = new ConfigManager({ appDir: tempDir });
      cm.loadRootConfig();
      assert.equal(cm.pick(['nonexistent']), undefined);
    });
  });

  describe('getBoolean', () => {
    it('parses true values', () => {
      fs.writeFileSync(path.join(tempDir, 'extra.conf'), 'flag=yes\n');
      const cm = new ConfigManager({ appDir: tempDir });
      cm.loadRootConfig();
      assert.equal(cm.getBoolean(['flag']), true);
    });

    it('returns fallback for missing key', () => {
      const cm = new ConfigManager({ appDir: tempDir });
      cm.loadRootConfig();
      assert.equal(cm.getBoolean(['missing'], true), true);
      assert.equal(cm.getBoolean(['missing'], false), false);
    });
  });

  describe('getNumber', () => {
    it('parses numeric value within bounds', () => {
      fs.writeFileSync(path.join(tempDir, 'extra.conf'), 'timeout=500\n');
      const cm = new ConfigManager({ appDir: tempDir });
      cm.loadRootConfig();
      assert.equal(cm.getNumber(['timeout'], 100, { min: 0, max: 1000 }), 500);
    });

    it('returns fallback when out of bounds', () => {
      fs.writeFileSync(path.join(tempDir, 'extra.conf'), 'timeout=5000\n');
      const cm = new ConfigManager({ appDir: tempDir });
      cm.loadRootConfig();
      assert.equal(cm.getNumber(['timeout'], 100, { min: 0, max: 1000 }), 100);
    });
  });

  describe('getInt', () => {
    it('truncates to integer', () => {
      fs.writeFileSync(path.join(tempDir, 'extra.conf'), 'count=7.9\n');
      const cm = new ConfigManager({ appDir: tempDir });
      cm.loadRootConfig();
      assert.equal(cm.getInt(['count'], 0), 7);
    });
  });

  describe('getString', () => {
    it('returns stripped string value', () => {
      fs.writeFileSync(path.join(tempDir, 'extra.conf'), 'name="hello"\n');
      const cm = new ConfigManager({ appDir: tempDir });
      cm.loadRootConfig();
      assert.equal(cm.getString(['name'], 'default'), 'hello');
    });

    it('returns fallback for missing key', () => {
      const cm = new ConfigManager({ appDir: tempDir });
      cm.loadRootConfig();
      assert.equal(cm.getString(['missing'], 'fallback'), 'fallback');
    });
  });
});

describe('ConfigManager static helpers', () => {
  it('stripWrappingQuotes strips double quotes', () => {
    assert.equal(ConfigManager.stripWrappingQuotes('"hello"'), 'hello');
  });

  it('stripWrappingQuotes strips single quotes', () => {
    assert.equal(ConfigManager.stripWrappingQuotes("'hello'"), 'hello');
  });

  it('stripWrappingQuotes returns unquoted strings as-is', () => {
    assert.equal(ConfigManager.stripWrappingQuotes('hello'), 'hello');
  });

  it('pickConfigValue finds first matching key', () => {
    assert.equal(ConfigManager.pickConfigValue({ a: '1', b: '2' }, ['b', 'a']), '2');
  });

  it('parseBooleanConfigValue handles truthy values', () => {
    for (const val of ['1', 'true', 'yes', 'on', 'enable', 'enabled']) {
      assert.equal(ConfigManager.parseBooleanConfigValue(val), true, `expected true for "${val}"`);
    }
  });

  it('parseBooleanConfigValue handles falsy values', () => {
    for (const val of ['0', 'false', 'no', 'off', 'disable', 'disabled']) {
      assert.equal(ConfigManager.parseBooleanConfigValue(val), false, `expected false for "${val}"`);
    }
  });

  it('parseBoundedNumberConfigValue returns fallback for out-of-range', () => {
    assert.equal(ConfigManager.parseBoundedNumberConfigValue('150', 10, { min: 0, max: 100 }), 10);
  });

  it('parseDspTransitionOutputFormat normalizes mp3/wav', () => {
    assert.equal(ConfigManager.parseDspTransitionOutputFormat('MP3'), 'mp3');
    assert.equal(ConfigManager.parseDspTransitionOutputFormat('WAV'), 'wav');
    assert.equal(ConfigManager.parseDspTransitionOutputFormat('ogg'), 'wav');
  });

  it('parsePortCandidate validates port range', () => {
    assert.equal(ConfigManager.parsePortCandidate('8080'), 8080);
    assert.equal(ConfigManager.parsePortCandidate('0'), null);
    assert.equal(ConfigManager.parsePortCandidate('99999'), null);
    assert.equal(ConfigManager.parsePortCandidate('abc'), null);
  });

  it('resolvePortValue prefers env over config', () => {
    assert.equal(ConfigManager.resolvePortValue('8080', '9090', 3000), 8080);
    assert.equal(ConfigManager.resolvePortValue(null, '9090', 3000), 9090);
    assert.equal(ConfigManager.resolvePortValue(null, null, 3000), 3000);
  });
});
