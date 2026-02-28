class AudioEngine {
  constructor() {
    this.activeSources = [];
  }

  play(segment) {
    this.activeSources = [this.normalizeSegment(segment)];
    return this.getActiveSources();
  }

  stopAll() {
    this.activeSources = [];
  }

  planTransition(currentSegment, nextSegment, settings = {}) {
    const current = this.normalizeSegment(currentSegment);
    const next = this.normalizeSegment(nextSegment);
    const isTrackToTrack = current.kind === 'track' && next.kind === 'track';
    return {
      overlapApplied: Boolean(settings.overlapEnabled) && isTrackToTrack,
      fadeApplied: Boolean(settings.fadeEnabled) && isTrackToTrack,
      next,
    };
  }

  normalizeSegment(segment = {}) {
    if (segment.kind === 'dsp_fragment') {
      return {
        ...segment,
        overlapAllowed: false,
        fadeAllowed: false,
      };
    }
    return {
      ...segment,
      overlapAllowed: segment.overlapAllowed !== false,
      fadeAllowed: segment.fadeAllowed !== false,
    };
  }

  getActiveSources() {
    return this.activeSources.map((source) => ({ ...source }));
  }
}

module.exports = {
  AudioEngine,
};
