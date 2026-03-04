'use strict';

const { sendJson } = require('../errors');

const ROLE_COHOST = 'co-host';

/**
 * Creates an auth guard function used by HttpRouter.
 * @param {import('../../auth/AuthService')} authService
 * @returns {function(req, res, level, options): boolean} - returns true if request is allowed
 */
function createAuthGuard(authService) {
  return function authGuard(req, res, level, options) {
    const auth = authService.getAuthState(req);
    req.auth = auth;

    if (level === 'none') return true;

    if (!auth.authenticated) {
      if (options && options.responseKind === 'text') {
        res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Unauthorized');
      } else {
        sendJson(res, 401, { error: 'Требуется авторизация' });
      }
      return false;
    }

    if (level === 'session') return true;

    if (level === 'host') {
      if (!auth.isServer) {
        sendJson(res, 403, { error: 'Только хост может выполнять это действие' });
        return false;
      }
      return true;
    }

    if (level === 'host|cohost') {
      if (!auth.isServer && auth.role !== ROLE_COHOST) {
        sendJson(res, 403, { error: 'Только хост или co-host может выполнять это действие' });
        return false;
      }
      return true;
    }

    return true;
  };
}

module.exports = { createAuthGuard };
