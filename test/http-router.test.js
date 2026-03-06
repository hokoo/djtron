'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { HttpRouter, compilePath } = require('../src/http/HttpRouter');
const { AuthService } = require('../src/auth/AuthService');
const { createAuthGuard } = require('../src/http/middlewares/auth');

// --- Helpers ---

function mockReq(method, url, authState) {
  return {
    method,
    url,
    headers: { host: 'localhost:3000' },
    _authState: authState || { authenticated: false, isServer: false, role: null, username: null, token: null },
  };
}

function mockRes() {
  const res = {
    statusCode: null,
    headers: {},
    body: '',
    writeHead(code, headers) {
      res.statusCode = code;
      if (headers) Object.assign(res.headers, headers);
    },
    end(body) {
      res.body = body || '';
    },
    setHeader(name, value) {
      res.headers[name] = value;
    },
  };
  return res;
}

function createTestRouter(authOverride) {
  const getAuthStateFn = (req) => req._authState;
  const authService = new AuthService({ getAuthStateFn });
  const authGuard = authOverride || createAuthGuard(authService);
  const router = new HttpRouter({ authGuard });
  return router;
}

const AUTH_NONE = { authenticated: false, isServer: false, role: null, username: null };
const AUTH_SESSION = { authenticated: true, isServer: false, role: 'slave', username: 'testuser' };
const AUTH_HOST = { authenticated: true, isServer: true, role: 'host', username: 'server' };
const AUTH_COHOST = { authenticated: true, isServer: false, role: 'co-host', username: 'dj' };

// --- compilePath tests ---

describe('compilePath', () => {
  it('compiles exact paths', () => {
    const { regex, paramNames, isWildcard } = compilePath('/api/auth/session');
    assert.equal(isWildcard, false);
    assert.deepEqual(paramNames, []);
    assert.ok(regex.test('/api/auth/session'));
    assert.ok(!regex.test('/api/auth/session/extra'));
    assert.ok(!regex.test('/api/auth'));
  });

  it('compiles param paths', () => {
    const { regex, paramNames, isWildcard } = compilePath('/api/dsp/transitions/file/:id');
    assert.equal(isWildcard, false);
    assert.deepEqual(paramNames, ['id']);
    const match = regex.exec('/api/dsp/transitions/file/abc123');
    assert.ok(match);
    assert.equal(match[1], 'abc123');
    assert.ok(!regex.test('/api/dsp/transitions/file/'));
    assert.ok(!regex.test('/api/dsp/transitions/file/a/b'));
  });

  it('compiles wildcard paths', () => {
    const { regex, paramNames, isWildcard } = compilePath('/audio/*');
    assert.equal(isWildcard, true);
    assert.deepEqual(paramNames, ['*']);
    const match = regex.exec('/audio/path/to/file.mp3');
    assert.ok(match);
    assert.equal(match[1], 'path/to/file.mp3');
  });

  it('compiles catch-all wildcard', () => {
    const { regex, paramNames, isWildcard } = compilePath('/*');
    assert.equal(isWildcard, true);
    const match = regex.exec('/anything/here');
    assert.ok(match);
    assert.equal(match[1], 'anything/here');
  });
});

// --- HttpRouter dispatch tests ---

describe('HttpRouter dispatch', () => {
  it('dispatches to matching route', () => {
    const router = createTestRouter();
    let called = false;
    router.register('GET', '/api/test', (req, res) => { called = true; }, { auth: 'none' });

    const req = mockReq('GET', '/api/test');
    const res = mockRes();
    router.dispatch(req, res);
    assert.ok(called);
  });

  it('returns 405 for path match but method mismatch', () => {
    const router = createTestRouter();
    router.register('GET', '/api/test', () => {}, { auth: 'none' });

    const req = mockReq('POST', '/api/test');
    const res = mockRes();
    router.dispatch(req, res);
    assert.equal(res.statusCode, 405);
    assert.equal(res.body, 'Method Not Allowed');
  });

  it('returns 404 when no route matches', () => {
    const router = createTestRouter();
    router.register('GET', '/api/test', () => {}, { auth: 'none' });

    const req = mockReq('GET', '/api/other');
    const res = mockRes();
    router.dispatch(req, res);
    assert.equal(res.statusCode, 404);
  });

  it('returns 400 for malformed URL', () => {
    const router = createTestRouter();
    const req = mockReq('GET', '/%ZZ');
    const res = mockRes();
    router.dispatch(req, res);
    assert.equal(res.statusCode, 400);
  });

  it('sets req.params for parameterized routes', () => {
    const router = createTestRouter();
    let capturedParams = null;
    router.register('GET', '/api/items/:id', (req) => { capturedParams = req.params; }, { auth: 'none' });

    const req = mockReq('GET', '/api/items/42');
    router.dispatch(req, mockRes());
    assert.deepEqual(capturedParams, { id: '42' });
  });

  it('sets req.parsedUrl and req.pathname', () => {
    const router = createTestRouter();
    let capturedUrl = null;
    let capturedPathname = null;
    router.register('GET', '/api/test', (req) => {
      capturedUrl = req.parsedUrl;
      capturedPathname = req.pathname;
    }, { auth: 'none' });

    const req = mockReq('GET', '/api/test?foo=bar');
    router.dispatch(req, mockRes());
    assert.equal(capturedPathname, '/api/test');
    assert.equal(capturedUrl.searchParams.get('foo'), 'bar');
  });

  it('supports multi-method registration (GET|HEAD)', () => {
    const router = createTestRouter();
    let callCount = 0;
    router.register('GET|HEAD', '/api/file', () => { callCount++; }, { auth: 'none' });

    router.dispatch(mockReq('GET', '/api/file'), mockRes());
    router.dispatch(mockReq('HEAD', '/api/file'), mockRes());
    assert.equal(callCount, 2);

    const res = mockRes();
    router.dispatch(mockReq('POST', '/api/file'), res);
    assert.equal(res.statusCode, 405);
  });

  it('specific routes take priority over wildcards for 405', () => {
    const router = createTestRouter();
    let wildcardCalled = false;
    router.register('GET', '/api/data', () => {}, { auth: 'none' });
    router.register('GET|HEAD', '/*', () => { wildcardCalled = true; }, { auth: 'none' });

    const res = mockRes();
    router.dispatch(mockReq('DELETE', '/api/data'), res);
    assert.equal(res.statusCode, 405);
    assert.ok(!wildcardCalled);
  });

  it('wildcard routes match when no specific route matches', () => {
    const router = createTestRouter();
    let wildcardCalled = false;
    router.register('GET', '/api/known', () => {}, { auth: 'none' });
    router.register('GET|HEAD', '/*', () => { wildcardCalled = true; }, { auth: 'none' });

    router.dispatch(mockReq('GET', '/something/else'), mockRes());
    assert.ok(wildcardCalled);
  });

  it('wildcard route ordering is preserved (first match wins)', () => {
    const router = createTestRouter();
    let matched = null;
    router.register('GET|HEAD', '/audio/*', () => { matched = 'audio'; }, { auth: 'none' });
    router.register('GET|HEAD', '/*', () => { matched = 'public'; }, { auth: 'none' });

    router.dispatch(mockReq('GET', '/audio/track.mp3'), mockRes());
    assert.equal(matched, 'audio');

    matched = null;
    router.dispatch(mockReq('GET', '/index.html'), mockRes());
    assert.equal(matched, 'public');
  });

  it('two routes on the same path with different methods', () => {
    const router = createTestRouter();
    let handler = null;
    router.register('GET', '/api/layout', () => { handler = 'get'; }, { auth: 'none' });
    router.register('POST', '/api/layout', () => { handler = 'post'; }, { auth: 'none' });

    router.dispatch(mockReq('GET', '/api/layout'), mockRes());
    assert.equal(handler, 'get');

    router.dispatch(mockReq('POST', '/api/layout'), mockRes());
    assert.equal(handler, 'post');

    const res = mockRes();
    router.dispatch(mockReq('PUT', '/api/layout'), res);
    assert.equal(res.statusCode, 405);
  });
});

// --- Auth guard tests ---

describe('auth guard', () => {
  it('auth:none allows unauthenticated requests', () => {
    const router = createTestRouter();
    let called = false;
    router.register('GET', '/public', () => { called = true; }, { auth: 'none' });

    router.dispatch(mockReq('GET', '/public', AUTH_NONE), mockRes());
    assert.ok(called);
  });

  it('auth:none sets req.auth', () => {
    const router = createTestRouter();
    let capturedAuth = null;
    router.register('GET', '/public', (req) => { capturedAuth = req.auth; }, { auth: 'none' });

    router.dispatch(mockReq('GET', '/public', AUTH_SESSION), mockRes());
    assert.equal(capturedAuth.authenticated, true);
    assert.equal(capturedAuth.username, 'testuser');
  });

  it('auth:session rejects unauthenticated (401 JSON)', () => {
    const router = createTestRouter();
    router.register('GET', '/api/data', () => {}, { auth: 'session' });

    const res = mockRes();
    router.dispatch(mockReq('GET', '/api/data', AUTH_NONE), res);
    assert.equal(res.statusCode, 401);
    const body = JSON.parse(res.body);
    assert.equal(body.error, 'Требуется авторизация');
  });

  it('auth:session allows authenticated users', () => {
    const router = createTestRouter();
    let called = false;
    router.register('GET', '/api/data', () => { called = true; }, { auth: 'session' });

    router.dispatch(mockReq('GET', '/api/data', AUTH_SESSION), mockRes());
    assert.ok(called);
  });

  it('auth:session allows server requests', () => {
    const router = createTestRouter();
    let called = false;
    router.register('GET', '/api/data', () => { called = true; }, { auth: 'session' });

    router.dispatch(mockReq('GET', '/api/data', AUTH_HOST), mockRes());
    assert.ok(called);
  });

  it('auth:host rejects non-server authenticated users (403)', () => {
    const router = createTestRouter();
    router.register('POST', '/api/admin', () => {}, { auth: 'host' });

    const res = mockRes();
    router.dispatch(mockReq('POST', '/api/admin', AUTH_SESSION), res);
    assert.equal(res.statusCode, 403);
    const body = JSON.parse(res.body);
    assert.equal(body.error, 'Только хост может выполнять это действие');
  });

  it('auth:host rejects unauthenticated (401)', () => {
    const router = createTestRouter();
    router.register('POST', '/api/admin', () => {}, { auth: 'host' });

    const res = mockRes();
    router.dispatch(mockReq('POST', '/api/admin', AUTH_NONE), res);
    assert.equal(res.statusCode, 401);
  });

  it('auth:host allows server requests', () => {
    const router = createTestRouter();
    let called = false;
    router.register('POST', '/api/admin', () => { called = true; }, { auth: 'host' });

    router.dispatch(mockReq('POST', '/api/admin', AUTH_HOST), mockRes());
    assert.ok(called);
  });

  it('auth:host|cohost allows server requests', () => {
    const router = createTestRouter();
    let called = false;
    router.register('POST', '/api/cmd', () => { called = true; }, { auth: 'host|cohost' });

    router.dispatch(mockReq('POST', '/api/cmd', AUTH_HOST), mockRes());
    assert.ok(called);
  });

  it('auth:host|cohost allows co-host', () => {
    const router = createTestRouter();
    let called = false;
    router.register('POST', '/api/cmd', () => { called = true; }, { auth: 'host|cohost' });

    router.dispatch(mockReq('POST', '/api/cmd', AUTH_COHOST), mockRes());
    assert.ok(called);
  });

  it('auth:host|cohost rejects regular slave (403)', () => {
    const router = createTestRouter();
    router.register('POST', '/api/cmd', () => {}, { auth: 'host|cohost' });

    const res = mockRes();
    router.dispatch(mockReq('POST', '/api/cmd', AUTH_SESSION), res);
    assert.equal(res.statusCode, 403);
  });

  it('auth:session with responseKind text returns text 401', () => {
    const router = createTestRouter();
    router.register('GET', '/audio/track', () => {}, { auth: 'session', authResponseKind: 'text' });

    const res = mockRes();
    router.dispatch(mockReq('GET', '/audio/track', AUTH_NONE), res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body, 'Unauthorized');
    assert.ok(res.headers['Content-Type'].includes('text/plain'));
  });
});

// --- AuthService tests ---

describe('AuthService', () => {
  it('delegates to getAuthStateFn', () => {
    const state = { authenticated: true, isServer: false, role: 'slave', username: 'test' };
    const service = new AuthService({ getAuthStateFn: () => state });
    const result = service.getAuthState({});
    assert.deepEqual(result, state);
  });

  it('throws when getAuthStateFn is not provided', () => {
    assert.throws(() => new AuthService({}), /getAuthStateFn/);
  });
});

// --- Full route table parity tests (mirrors actual route registration) ---

describe('route registration parity', () => {
  function createFullRouter() {
    const router = createTestRouter();
    // Mirrors the actual route registration in server.js
    router.register('GET', '/api/auth/session', (req, res) => { res.writeHead(200); res.end('auth-session'); }, { auth: 'none' });
    router.register('POST', '/api/auth/login', (req, res) => { res.writeHead(200); res.end('auth-login'); }, { auth: 'none' });
    router.register('POST', '/api/auth/logout', (req, res) => { res.writeHead(200); res.end('auth-logout'); }, { auth: 'none' });
    router.register('GET', '/api/auth/clients', (req, res) => { res.writeHead(200); res.end('auth-clients'); }, { auth: 'host' });
    router.register('POST', '/api/auth/clients/role', (req, res) => { res.writeHead(200); res.end('role'); }, { auth: 'host' });
    router.register('POST', '/api/auth/clients/disconnect', (req, res) => { res.writeHead(200); res.end('disconnect'); }, { auth: 'host' });
    router.register('GET', '/api/layout/stream', (req, res) => { res.writeHead(200); res.end('stream'); }, { auth: 'session' });
    router.register('POST', '/api/layout/reset', (req, res) => { res.writeHead(200); res.end('reset'); }, { auth: 'host' });
    router.register('GET', '/api/layout', (req, res) => { res.writeHead(200); res.end('layout-get'); }, { auth: 'session' });
    router.register('POST', '/api/layout', (req, res) => { res.writeHead(200); res.end('layout-post'); }, { auth: 'session' });
    router.register('GET', '/api/playback', (req, res) => { res.writeHead(200); res.end('playback-get'); }, { auth: 'session' });
    router.register('POST', '/api/playback', (req, res) => { res.writeHead(200); res.end('playback-post'); }, { auth: 'host' });
    router.register('POST', '/api/playback/command', (req, res) => { res.writeHead(200); res.end('command'); }, { auth: 'session' });
    router.register('POST', '/api/shutdown', (req, res) => { res.writeHead(200); res.end('shutdown'); }, { auth: 'host' });
    router.register('GET', '/api/audio', (req, res) => { res.writeHead(200); res.end('audio'); }, { auth: 'session' });
    router.register('GET', '/api/audio/attributes', (req, res) => { res.writeHead(200); res.end('attrs'); }, { auth: 'session' });
    router.register('GET', '/api/dsp/transitions', (req, res) => { res.writeHead(200); res.end('dsp-get'); }, { auth: 'session' });
    router.register('POST', '/api/dsp/transitions', (req, res) => { res.writeHead(200); res.end('dsp-post'); }, { auth: 'host' });
    router.register('GET|HEAD', '/api/dsp/transitions/file/:id', (req, res) => { res.writeHead(200); res.end('dsp-file'); }, { auth: 'session' });
    router.register('GET', '/api/config', (req, res) => { res.writeHead(200); res.end('config'); }, { auth: 'session' });
    router.register('GET', '/api/version', (req, res) => { res.writeHead(200); res.end('version'); }, { auth: 'session' });
    router.register('GET', '/api/update/check', (req, res) => { res.writeHead(200); res.end('check'); }, { auth: 'session' });
    router.register('POST', '/api/update/apply', (req, res) => { res.writeHead(200); res.end('apply'); }, { auth: 'session' });
    // Wildcard routes
    router.register('GET|HEAD', '/api/*', (req, res) => { res.writeHead(200); res.end('api-fallback'); }, { auth: 'session' });
    router.register('GET|HEAD', '/audio/*', (req, res) => { res.writeHead(200); res.end('audio-file'); }, { auth: 'session', authResponseKind: 'text' });
    router.register('GET|HEAD', '/*', (req, res) => { res.writeHead(200); res.end('public'); }, { auth: 'none' });
    return router;
  }

  it('GET /api/auth/session (no auth) routes correctly', () => {
    const router = createFullRouter();
    const res = mockRes();
    router.dispatch(mockReq('GET', '/api/auth/session', AUTH_NONE), res);
    assert.equal(res.body, 'auth-session');
  });

  it('POST /api/auth/login (no auth) routes correctly', () => {
    const router = createFullRouter();
    const res = mockRes();
    router.dispatch(mockReq('POST', '/api/auth/login', AUTH_NONE), res);
    assert.equal(res.body, 'auth-login');
  });

  it('GET /api/auth/clients requires host', () => {
    const router = createFullRouter();
    const res1 = mockRes();
    router.dispatch(mockReq('GET', '/api/auth/clients', AUTH_SESSION), res1);
    assert.equal(res1.statusCode, 403);

    const res2 = mockRes();
    router.dispatch(mockReq('GET', '/api/auth/clients', AUTH_HOST), res2);
    assert.equal(res2.body, 'auth-clients');
  });

  it('POST /api/playback/command requires session', () => {
    const router = createFullRouter();

    const res1 = mockRes();
    router.dispatch(mockReq('POST', '/api/playback/command', AUTH_SESSION), res1);
    assert.equal(res1.body, 'command');

    const res2 = mockRes();
    router.dispatch(mockReq('POST', '/api/playback/command', AUTH_HOST), res2);
    assert.equal(res2.body, 'command');

    const res3 = mockRes();
    router.dispatch(mockReq('POST', '/api/playback/command', AUTH_COHOST), res3);
    assert.equal(res3.body, 'command');

    const res4 = mockRes();
    router.dispatch(mockReq('POST', '/api/playback/command', AUTH_NONE), res4);
    assert.equal(res4.statusCode, 401);
  });

  it('DELETE /api/auth/session returns 405', () => {
    const router = createFullRouter();
    const res = mockRes();
    router.dispatch(mockReq('DELETE', '/api/auth/session', AUTH_HOST), res);
    assert.equal(res.statusCode, 405);
  });

  it('GET /api/layout and POST /api/layout dispatch to different handlers', () => {
    const router = createFullRouter();

    const res1 = mockRes();
    router.dispatch(mockReq('GET', '/api/layout', AUTH_SESSION), res1);
    assert.equal(res1.body, 'layout-get');

    const res2 = mockRes();
    router.dispatch(mockReq('POST', '/api/layout', AUTH_SESSION), res2);
    assert.equal(res2.body, 'layout-post');
  });

  it('GET /api/dsp/transitions/file/:id extracts param', () => {
    const router = createFullRouter();
    let params = null;
    // Override with a handler that captures params
    const router2 = createTestRouter();
    router2.register('GET|HEAD', '/api/dsp/transitions/file/:id', (req) => { params = req.params; }, { auth: 'none' });
    router2.dispatch(mockReq('GET', '/api/dsp/transitions/file/abc-123'), mockRes());
    assert.deepEqual(params, { id: 'abc-123' });
  });

  it('GET /audio/some/track.mp3 matches audio wildcard', () => {
    const router = createFullRouter();
    const res = mockRes();
    router.dispatch(mockReq('GET', '/audio/some/track.mp3', AUTH_SESSION), res);
    assert.equal(res.body, 'audio-file');
  });

  it('GET /audio/* without auth returns text 401', () => {
    const router = createFullRouter();
    const res = mockRes();
    router.dispatch(mockReq('GET', '/audio/track.mp3', AUTH_NONE), res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body, 'Unauthorized');
  });

  it('GET /favicon.ico falls through to public catch-all', () => {
    const router = createFullRouter();
    const res = mockRes();
    router.dispatch(mockReq('GET', '/favicon.ico', AUTH_NONE), res);
    assert.equal(res.body, 'public');
  });

  it('GET /api/unknown with session auth falls through to api catch-all', () => {
    const router = createFullRouter();
    const res = mockRes();
    router.dispatch(mockReq('GET', '/api/unknown', AUTH_SESSION), res);
    assert.equal(res.body, 'api-fallback');
  });

  it('GET /api/unknown without auth returns 401', () => {
    const router = createFullRouter();
    const res = mockRes();
    router.dispatch(mockReq('GET', '/api/unknown', AUTH_NONE), res);
    assert.equal(res.statusCode, 401);
  });

  it('POST /api/shutdown requires host', () => {
    const router = createFullRouter();

    const res1 = mockRes();
    router.dispatch(mockReq('POST', '/api/shutdown', AUTH_SESSION), res1);
    assert.equal(res1.statusCode, 403);

    const res2 = mockRes();
    router.dispatch(mockReq('POST', '/api/shutdown', AUTH_HOST), res2);
    assert.equal(res2.body, 'shutdown');
  });

  it('POST /api/layout/reset requires host', () => {
    const router = createFullRouter();

    const res1 = mockRes();
    router.dispatch(mockReq('POST', '/api/layout/reset', AUTH_SESSION), res1);
    assert.equal(res1.statusCode, 403);

    const res2 = mockRes();
    router.dispatch(mockReq('POST', '/api/layout/reset', AUTH_HOST), res2);
    assert.equal(res2.body, 'reset');
  });

  it('POST /api/dsp/transitions requires host', () => {
    const router = createFullRouter();

    const res1 = mockRes();
    router.dispatch(mockReq('POST', '/api/dsp/transitions', AUTH_SESSION), res1);
    assert.equal(res1.statusCode, 403);

    const res2 = mockRes();
    router.dispatch(mockReq('POST', '/api/dsp/transitions', AUTH_HOST), res2);
    assert.equal(res2.body, 'dsp-post');
  });
});
