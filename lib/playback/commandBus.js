class PlaybackCommandBus {
  constructor({ authorize, execute }) {
    this.authorize = typeof authorize === 'function' ? authorize : () => ({ allowed: true });
    this.execute = typeof execute === 'function' ? execute : () => {};
    this.queue = Promise.resolve();
  }

  dispatch(commandContext, payload) {
    const run = async () => {
      const decision = this.authorize(commandContext || {});
      if (!decision || decision.allowed !== true) {
        return {
          ok: false,
          reason: (decision && decision.reason) || 'ACCESS_DENIED',
          message: (decision && decision.message) || 'Команда отклонена',
        };
      }

      await this.execute(payload, commandContext || {});
      return { ok: true };
    };

    const resultPromise = this.queue.then(run, run);
    this.queue = resultPromise.then(() => undefined, () => undefined);
    return resultPromise;
  }
}

module.exports = {
  PlaybackCommandBus,
};
