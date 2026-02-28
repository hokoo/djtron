const ROLE_HOST = 'host';
const ROLE_COHOST = 'co-host';
const ROLE_SLAVE = 'slave';

const COHOST_ALLOWED_COMMANDS = new Set(['play-track', 'stop']);

function canDispatchLivePlaybackCommand({ sourceRole, commandType, isServer, target }) {
  if (isServer || sourceRole === ROLE_HOST) {
    return { allowed: true };
  }

  if (sourceRole === ROLE_COHOST) {
    const allowed = COHOST_ALLOWED_COMMANDS.has(commandType);
    return allowed
      ? { allowed: true }
      : { allowed: false, reason: 'ACCESS_DENIED', message: 'Co-host может отправлять только команды play-track и stop' };
  }

  if (sourceRole === ROLE_SLAVE) {
    if (commandType === 'play-next-request' && target === 'host') {
      return { allowed: true };
    }
    return { allowed: false, reason: 'ACCESS_DENIED', message: 'Slave не может напрямую управлять live, кроме Play Next на Host' };
  }

  return { allowed: false, reason: 'ACCESS_DENIED', message: 'Недостаточно прав для отправки live-команды' };
}

module.exports = {
  canDispatchLivePlaybackCommand,
};
