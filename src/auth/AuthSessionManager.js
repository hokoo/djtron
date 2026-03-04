'use strict';

class AuthSessionManager {
  /**
   * @param {object} options
   * @param {object} options.config
   * @param {RegExp} options.config.SESSION_TOKEN_PATTERN
   * @param {RegExp} options.config.USERNAME_PATTERN
   * @param {number} options.config.SESSION_TTL_MS
   * @param {string} options.config.ROLE_HOST
   * @param {string} options.config.ROLE_COHOST
   * @param {string} options.config.ROLE_SLAVE
   * @param {string} options.config.SESSIONS_STATE_PATH
   * @param {string} options.config.SESSION_COOKIE_NAME
   * @param {object} options.deps
   * @param {object} options.deps.crypto
   * @param {object} options.deps.fs
   * @param {function} options.deps.isServerRequest
   * @param {function} options.deps.parseCookies
   * @param {function} [options.deps.onSessionsChanged] - called after sessions mutate (persist + broadcast)
   */
  constructor({ config, deps }) {
    this._config = config;
    this._deps = deps;
    this._sessions = new Map();
    this._loadPersistedSessions();
    this._cleanupTimer = setInterval(() => this.cleanupExpiredSessions(), 5 * 60 * 1000);
    this._cleanupTimer.unref();
  }

  // --- Static pure helpers ---

  static sanitizeSessionRole(value, roleCohost, roleSlave) {
    return value === roleCohost ? roleCohost : roleSlave;
  }

  static sanitizeSessionRecord(token, rawSession, now, tokenPattern, usernamePattern, roleCohost, roleSlave) {
    if (!tokenPattern.test(token)) return null;
    if (!rawSession || typeof rawSession !== 'object') return null;

    const username = typeof rawSession.username === 'string' ? rawSession.username : '';
    const expiresAt = Number(rawSession.expiresAt);
    const role = AuthSessionManager.sanitizeSessionRole(rawSession.role, roleCohost, roleSlave);

    if (!usernamePattern.test(username)) return null;
    if (!Number.isFinite(expiresAt) || expiresAt <= now) return null;

    return { username, expiresAt, role };
  }

  static normalizeUsername(value, usernamePattern) {
    if (typeof value !== 'string') return null;
    const username = value.trim();
    if (!usernamePattern.test(username)) return null;
    return username;
  }

  static sanitizeManagedUserRole(value, roleCohost, roleSlave) {
    return value === roleCohost ? roleCohost : roleSlave;
  }

  // --- Internal helpers ---

  _sanitizeRecord(token, rawSession, now) {
    const { SESSION_TOKEN_PATTERN, USERNAME_PATTERN, ROLE_COHOST, ROLE_SLAVE } = this._config;
    return AuthSessionManager.sanitizeSessionRecord(
      token, rawSession, now, SESSION_TOKEN_PATTERN, USERNAME_PATTERN, ROLE_COHOST, ROLE_SLAVE
    );
  }

  _sanitizeRole(value) {
    return AuthSessionManager.sanitizeSessionRole(value, this._config.ROLE_COHOST, this._config.ROLE_SLAVE);
  }

  _normalizeUsername(value) {
    return AuthSessionManager.normalizeUsername(value, this._config.USERNAME_PATTERN);
  }

  _notifyChanged() {
    if (typeof this._deps.onSessionsChanged === 'function') {
      this._deps.onSessionsChanged();
    }
  }

  // --- Session persistence ---

  persistSessions() {
    try {
      const now = Date.now();
      const serialized = {};

      for (const [token, rawSession] of this._sessions.entries()) {
        const session = this._sanitizeRecord(token, rawSession, now);
        if (!session) {
          this._sessions.delete(token);
          continue;
        }
        serialized[token] = session;
      }

      this._deps.fs.writeFileSync(this._config.SESSIONS_STATE_PATH, JSON.stringify(serialized, null, 2), 'utf8');
    } catch (err) {
      console.error('Failed to persist auth sessions cache', err);
    }
  }

  _loadPersistedSessions() {
    try {
      if (!this._deps.fs.existsSync(this._config.SESSIONS_STATE_PATH)) return;

      const raw = this._deps.fs.readFileSync(this._config.SESSIONS_STATE_PATH, 'utf8');
      if (!raw.trim()) return;

      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Invalid auth sessions cache format');
      }

      const now = Date.now();
      let hasInvalidEntries = false;

      for (const [token, rawSession] of Object.entries(parsed)) {
        const session = this._sanitizeRecord(token, rawSession, now);
        if (!session) {
          hasInvalidEntries = true;
          continue;
        }
        this._sessions.set(token, session);
      }

      if (hasInvalidEntries) {
        this.persistSessions();
      }
    } catch (err) {
      console.error('Failed to load auth sessions cache', err);
    }
  }

  // --- Session token ---

  createSessionToken() {
    return this._deps.crypto.randomBytes(32).toString('hex');
  }

  // --- Active users ---

  collectActiveAuthUsers() {
    const now = Date.now();
    const { ROLE_SLAVE, ROLE_COHOST } = this._config;
    const groupedByUsername = new Map();
    let hasInvalidEntries = false;

    for (const [token, rawSession] of this._sessions.entries()) {
      const session = this._sanitizeRecord(token, rawSession, now);
      if (!session) {
        this._sessions.delete(token);
        hasInvalidEntries = true;
        continue;
      }

      const existing = groupedByUsername.get(session.username) || {
        username: session.username,
        role: ROLE_SLAVE,
        sessionCount: 0,
        expiresAt: 0,
      };
      existing.sessionCount += 1;
      if (session.role === ROLE_COHOST) {
        existing.role = ROLE_COHOST;
      }
      if (session.expiresAt > existing.expiresAt) {
        existing.expiresAt = session.expiresAt;
      }
      groupedByUsername.set(session.username, existing);
    }

    if (hasInvalidEntries) {
      this.persistSessions();
    }

    return Array.from(groupedByUsername.values()).sort((left, right) => left.username.localeCompare(right.username, 'ru'));
  }

  buildAuthUsersPayload(sourceClientId = null) {
    return {
      users: this.collectActiveAuthUsers(),
      sourceClientId,
    };
  }

  // --- Session CRUD ---

  resolveDefaultRoleForUsername(username) {
    const normalizedUsername = this._normalizeUsername(username);
    if (!normalizedUsername) return this._config.ROLE_SLAVE;

    for (const session of this._sessions.values()) {
      if (!session || session.username !== normalizedUsername) continue;
      if (this._sanitizeRole(session.role) === this._config.ROLE_COHOST) {
        return this._config.ROLE_COHOST;
      }
    }

    return this._config.ROLE_SLAVE;
  }

  createSession(username) {
    const sessionRole = this.resolveDefaultRoleForUsername(username);
    const token = this.createSessionToken();
    this._sessions.set(token, {
      username,
      expiresAt: Date.now() + this._config.SESSION_TTL_MS,
      role: sessionRole,
    });
    this.persistSessions();
    this._notifyChanged();
    return { token, role: sessionRole };
  }

  getSessionByToken(token) {
    if (!token) return null;
    const session = this._sessions.get(token);
    if (!session) return null;
    if (session.expiresAt <= Date.now()) {
      this._sessions.delete(token);
      this.persistSessions();
      this._notifyChanged();
      return null;
    }
    return session;
  }

  destroySession(token) {
    if (!token) return;
    if (this._sessions.delete(token)) {
      this.persistSessions();
      this._notifyChanged();
    }
  }

  cleanupExpiredSessions() {
    const now = Date.now();
    let changed = false;

    for (const [token, session] of this._sessions.entries()) {
      if (!session || session.expiresAt <= now) {
        this._sessions.delete(token);
        changed = true;
      }
    }

    if (changed) {
      this.persistSessions();
      this._notifyChanged();
    }
  }

  // --- Cookie helpers ---

  setSessionCookie(res, token) {
    const maxAge = Math.floor(this._config.SESSION_TTL_MS / 1000);
    res.setHeader('Set-Cookie', `${this._config.SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`);
  }

  clearSessionCookie(res) {
    res.setHeader('Set-Cookie', `${this._config.SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  }

  // --- Auth state (used by middleware) ---

  getAuthState(req) {
    if (this._deps.isServerRequest(req)) {
      return {
        authenticated: true,
        isServer: true,
        role: this._config.ROLE_HOST,
        username: 'server',
      };
    }

    const cookies = this._deps.parseCookies(req);
    const token = cookies[this._config.SESSION_COOKIE_NAME];
    const session = this.getSessionByToken(token);

    if (!session) {
      return {
        authenticated: false,
        isServer: false,
        role: null,
        username: null,
        token: null,
      };
    }

    return {
      authenticated: true,
      isServer: false,
      role: this._sanitizeRole(session.role),
      username: session.username,
      token,
    };
  }

  // --- User management ---

  setRoleForActiveUserSessions(username, role) {
    const normalizedUsername = this._normalizeUsername(username);
    if (!normalizedUsername) {
      return { matchedSessions: 0, changed: false };
    }

    const nextRole = AuthSessionManager.sanitizeManagedUserRole(role, this._config.ROLE_COHOST, this._config.ROLE_SLAVE);
    const now = Date.now();
    let matchedSessions = 0;
    let changed = false;
    let hasInvalidEntries = false;

    for (const [token, rawSession] of this._sessions.entries()) {
      const session = this._sanitizeRecord(token, rawSession, now);
      if (!session) {
        this._sessions.delete(token);
        hasInvalidEntries = true;
        continue;
      }

      if (session.username !== normalizedUsername) continue;
      matchedSessions += 1;
      const currentRole = session.role;
      if (currentRole === nextRole) continue;
      rawSession.role = nextRole;
      changed = true;
    }

    if (hasInvalidEntries || changed) {
      this.persistSessions();
    }
    if (changed || hasInvalidEntries) {
      this._notifyChanged();
    }

    return { matchedSessions, changed };
  }

  disconnectActiveUserSessions(username) {
    const normalizedUsername = this._normalizeUsername(username);
    if (!normalizedUsername) {
      return { removedSessions: 0 };
    }

    const now = Date.now();
    let removedSessions = 0;
    let hasInvalidEntries = false;

    for (const [token, rawSession] of this._sessions.entries()) {
      const session = this._sanitizeRecord(token, rawSession, now);
      if (!session) {
        this._sessions.delete(token);
        hasInvalidEntries = true;
        continue;
      }

      if (session.username !== normalizedUsername) continue;
      this._sessions.delete(token);
      removedSessions += 1;
    }

    if (removedSessions > 0 || hasInvalidEntries) {
      this.persistSessions();
      this._notifyChanged();
    }

    return { removedSessions };
  }

  // --- Accessors ---

  get sessions() {
    return this._sessions;
  }
}

module.exports = { AuthSessionManager };
