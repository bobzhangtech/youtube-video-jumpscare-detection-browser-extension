// Peak detection algorithm for heatmap data
// Uses modified z-score to find engagement spikes that correlate with jumpscares

const JSD_HEATMAP = (() => {
  "use strict";

  const Z_THRESHOLD = 0.7;
  const MIN_PROMINENCE = 0.05;
  const MIN_STDDEV = 0.01;

  function detectPeaks(heatMarkers) {
    if (!heatMarkers || heatMarkers.length === 0) return [];

    const intensities = heatMarkers.map((m) => m.intensity);

    // Compute mean
    const mean = intensities.reduce((a, b) => a + b, 0) / intensities.length;

    // Compute standard deviation
    const variance = intensities.reduce((sum, v) => sum + (v - mean) ** 2, 0) / intensities.length;
    const stdDev = Math.sqrt(variance);

    // Flat engagement — no meaningful peaks
    if (stdDev < MIN_STDDEV) return [];

    // Compute z-scores and flag candidates
    const candidates = heatMarkers.map((m, i) => ({
      ...m,
      index: i,
      zScore: (m.intensity - mean) / stdDev,
    })).filter((m) => m.zScore > Z_THRESHOLD);

    if (candidates.length === 0) return [];

    // Merge adjacent candidates into contiguous peak regions
    const regions = [];
    let currentRegion = [candidates[0]];

    for (let i = 1; i < candidates.length; i++) {
      if (candidates[i].index === candidates[i - 1].index + 1) {
        currentRegion.push(candidates[i]);
      } else {
        regions.push(currentRegion);
        currentRegion = [candidates[i]];
      }
    }
    regions.push(currentRegion);

    // Build peak objects from regions
    const peaks = [];
    for (const region of regions) {
      const maxMarker = region.reduce((best, m) => m.intensity > best.intensity ? m : best);
      const prominence = maxMarker.intensity - mean;

      if (prominence < MIN_PROMINENCE) continue;

      const firstMarker = region[0];
      const lastMarker = region[region.length - 1];

      peaks.push({
        timeMs: firstMarker.startMs,
        endMs: lastMarker.startMs + lastMarker.durationMs,
        peakTimeMs: maxMarker.startMs,
        intensity: maxMarker.intensity,
        zScore: maxMarker.zScore,
        source: "heatmap",
      });
    }

    return peaks;
  }

  return { detectPeaks };
})();
