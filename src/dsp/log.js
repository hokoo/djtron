'use strict';

function safeSerializeDspLogPayload(payload) {
  const normalizedPayload =
    payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : { value: payload };

  try {
    return JSON.stringify(normalizedPayload);
  } catch (err) {
    return JSON.stringify({ error: 'Failed to serialize DSP log payload' });
  }
}

function appendDspLog(eventName, payload, state, cfg, deps) {
  const event = typeof eventName === 'string' && eventName.trim() ? eventName.trim() : 'event';
  const line = `${new Date().toISOString()} ${event} ${safeSerializeDspLogPayload(payload)}\n`;
  try {
    deps.fs.appendFileSync(cfg.DSP_LOG_PATH, line, 'utf8');
  } catch (err) {
    if (state.dspLogWriteErrorShown) return;
    state.dspLogWriteErrorShown = true;
    console.error('Failed to write DSP log file', err);
  }
}

function initializeDspLogFile(cfg, deps) {
  try {
    const stat = deps.fs.statSync(cfg.DSP_LOG_PATH);
    if (!stat.isFile()) return;
    if (stat.size <= cfg.DSP_LOG_MAX_BYTES) return;

    const backupPath = `${cfg.DSP_LOG_PATH}.prev`;
    try {
      deps.fs.unlinkSync(backupPath);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        // keep going even if old backup cleanup fails
      }
    }
    deps.fs.renameSync(cfg.DSP_LOG_PATH, backupPath);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('Failed to initialize DSP log file', err);
    }
  }
}

module.exports = {
  safeSerializeDspLogPayload,
  appendDspLog,
  initializeDspLogFile,
};
