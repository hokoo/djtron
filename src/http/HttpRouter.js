'use strict';

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Compiles a route path pattern into a regex and param name list.
 * Supports :param (single segment) and * (wildcard, rest of path).
 *
 * Examples:
 *   /api/auth/session         → exact match
 *   /api/dsp/transitions/file/:id → param capture
 *   /audio/*                  → wildcard (captures everything after /audio/)
 *   /*                        → catch-all
 */
function compilePath(pattern) {
  const paramNames = [];
  const isWildcard = pattern.includes('*');
  const segments = pattern.split('/');
  const regexParts = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];

    // Skip leading empty segment from the split on '/'
    if (i === 0 && seg === '') continue;

    regexParts.push('\\/');

    if (seg === '*') {
      paramNames.push('*');
      regexParts.push('(.*)');
      break;
    }

    if (seg.startsWith(':')) {
      paramNames.push(seg.slice(1));
      regexParts.push('([^\\/]+)');
      continue;
    }

    regexParts.push(escapeRegex(seg));
  }

  let regexStr = regexParts.join('');
  if (!isWildcard) regexStr += '$';

  return { regex: new RegExp('^' + regexStr), paramNames, isWildcard };
}

class HttpRouter {
  /**
   * @param {object} opts
   * @param {function} opts.authGuard - (req, res, level, options) => boolean
   */
  constructor({ authGuard }) {
    this._authGuard = authGuard;
    this._specificRoutes = [];
    this._wildcardRoutes = [];
  }

  /**
   * Register a route.
   * @param {string} method - HTTP methods separated by '|', e.g. 'GET', 'GET|HEAD', 'POST'
   * @param {string} pathPattern - URL pattern, e.g. '/api/auth/session', '/audio/*'
   * @param {function} handler - (req, res) => void
   * @param {object} [options]
   * @param {string} [options.auth] - 'none'|'session'|'host'|'host|cohost' (default: 'none')
   * @param {string} [options.authResponseKind] - 'json'|'text' for 401 responses (default: 'json')
   */
  register(method, pathPattern, handler, options) {
    const methods = method.split('|').map((m) => m.trim().toUpperCase());
    const compiled = compilePath(pathPattern);
    const route = {
      methods,
      regex: compiled.regex,
      paramNames: compiled.paramNames,
      handler,
      options: options || {},
    };

    if (compiled.isWildcard) {
      this._wildcardRoutes.push(route);
    } else {
      this._specificRoutes.push(route);
    }
  }

  /**
   * Dispatch an incoming HTTP request.
   * Two-phase matching: specific routes first (for correct 405), then wildcard routes.
   */
  dispatch(req, res) {
    let pathname;
    let url;

    try {
      url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      pathname = decodeURIComponent(url.pathname);
    } catch (e) {
      res.writeHead(400);
      res.end('Bad Request');
      return;
    }

    // Phase 1: specific routes (no wildcards)
    let specificPathMatched = false;

    for (const route of this._specificRoutes) {
      const match = route.regex.exec(pathname);
      if (!match) continue;

      if (route.methods.includes(req.method)) {
        this._executeRoute(req, res, route, match, url, pathname);
        return;
      }

      specificPathMatched = true;
    }

    if (specificPathMatched) {
      res.writeHead(405);
      res.end('Method Not Allowed');
      return;
    }

    // Phase 2: wildcard routes (in registration order)
    let wildcardPathMatched = false;

    for (const route of this._wildcardRoutes) {
      const match = route.regex.exec(pathname);
      if (!match) continue;

      if (route.methods.includes(req.method)) {
        this._executeRoute(req, res, route, match, url, pathname);
        return;
      }

      wildcardPathMatched = true;
    }

    if (wildcardPathMatched) {
      res.writeHead(405);
      res.end('Method Not Allowed');
      return;
    }

    // No route matched at all
    res.writeHead(404);
    res.end('Not Found');
  }

  /** @private */
  _executeRoute(req, res, route, match, url, pathname) {
    const params = {};
    for (let i = 0; i < route.paramNames.length; i++) {
      params[route.paramNames[i]] = match[i + 1] || '';
    }
    req.params = params;
    req.parsedUrl = url;
    req.pathname = pathname;

    const authLevel = route.options.auth || 'none';
    const authOptions = route.options.authResponseKind
      ? { responseKind: route.options.authResponseKind }
      : undefined;

    if (!this._authGuard(req, res, authLevel, authOptions)) return;

    route.handler(req, res);
  }
}

module.exports = { HttpRouter, compilePath };
