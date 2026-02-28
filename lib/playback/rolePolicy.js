const ROLE_HOST = 'host';
const ROLE_COHOST = 'co-host';

const COHOST_ALLOWED_COMMANDS = new Set(['play-track', 'toggle-current']);

function canDispatchLivePlaybackCommand({ sourceRole, commandType, isServer }) {
  if (isServer || sourceRole === ROLE_HOST) {
    return { allowed: true };
  }

  if (sourceRole === ROLE_COHOST) {
    const allowed = COHOST_ALLOWED_COMMANDS.has(commandType);
    return allowed
      ? { allowed: true }
      : { allowed: false, reason: 'ACCESS_DENIED', message: 'Co-host может отправлять только play/stop команды' };
  }

  return { allowed: false, reason: 'ACCESS_DENIED', message: 'Недостаточно прав для отправки live-команды' };
}

module.exports = {
  canDispatchLivePlaybackCommand,
};
