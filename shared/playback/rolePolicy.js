export const ROLE_HOST = 'host';
export const ROLE_COHOST = 'co-host';
export const ROLE_SLAVE = 'slave';

const COHOST_ALLOWED_COMMANDS = new Set(['play-track', 'stop']);
const SLAVE_LOCAL_ALLOWED_COMMANDS = new Set(['play-track', 'stop']);

export function canDispatchLivePlaybackCommand({ sourceRole, commandType, isServer, target }) {
  const normalizedTarget = target === 'self' ? 'self' : 'host';

  if (isServer || sourceRole === ROLE_HOST) {
    return { allowed: true };
  }

  if (sourceRole === ROLE_COHOST) {
    const allowed = normalizedTarget === 'host' && COHOST_ALLOWED_COMMANDS.has(commandType);
    return allowed
      ? { allowed: true }
      : {
          allowed: false,
          reason: 'ACCESS_DENIED',
          message: 'Co-host может отправлять на host только команды play-track и stop',
        };
  }

  if (sourceRole === ROLE_SLAVE) {
    if (commandType === 'play-next-request' && normalizedTarget === 'host') {
      return { allowed: true };
    }
    if (normalizedTarget === 'self' && SLAVE_LOCAL_ALLOWED_COMMANDS.has(commandType)) {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: 'ACCESS_DENIED',
      message: 'Slave может выполнять локально только play-track/stop или отправлять Play Next на host',
    };
  }

  return { allowed: false, reason: 'ACCESS_DENIED', message: 'Недостаточно прав для отправки live-команды' };
}
