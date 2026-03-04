'use strict';

class AuthService {
  /**
   * @param {object} deps
   * @param {function} deps.getAuthStateFn - (req) => { authenticated, isServer, role, username, token }
   */
  constructor({ getAuthStateFn }) {
    if (typeof getAuthStateFn !== 'function') {
      throw new Error('AuthService requires getAuthStateFn');
    }
    this._getAuthState = getAuthStateFn;
  }

  getAuthState(req) {
    return this._getAuthState(req);
  }
}

module.exports = { AuthService };
