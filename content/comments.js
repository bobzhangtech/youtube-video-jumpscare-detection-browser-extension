// Comment analysis — extract timestamps and filter by jumpscare-related keywords

const JSD_COMMENTS = (() => {
  "use strict";

  const TIMESTAMP_RE = /(\d{1,2}):(\d{2})(?::(\d{2}))?/g;

  const MIN_TIMESTAMPS_FOR_LIST = 3; // A comment with 3+ timestamps is likely a jumpscare list

  function countTimestamps(text) {
    TIMESTAMP_RE.lastIndex = 0;
    let count = 0;
    while (TIMESTAMP_RE.exec(text) !== null) count++;
    return count;
  }

  function extractTimestamps(text) {
    const timestamps = [];
    let match;
    TIMESTAMP_RE.lastIndex = 0;
    while ((match = TIMESTAMP_RE.exec(text)) !== null) {
      const hours = match[3] !== undefined ? parseInt(match[1], 10) : 0;
      const minutes = match[3] !== undefined ? parseInt(match[2], 10) : parseInt(match[1], 10);
      const seconds = match[3] !== undefined ? parseInt(match[3], 10) : parseInt(match[2], 10);

      const timeMs = (hours * 3600 + minutes * 60 + seconds) * 1000;

      // Build a short snippet around the timestamp
      const snippetStart = Math.max(0, match.index - 20);
      const snippetEnd = Math.min(text.length, match.index + match[0].length + 40);
      let snippet = text.slice(snippetStart, snippetEnd).trim();
      if (snippetStart > 0) snippet = "..." + snippet;
      if (snippetEnd < text.length) snippet = snippet + "...";

      timestamps.push({ timeMs, source: "comment", snippet });
    }
    return timestamps;
  }

  const DEDUP_WINDOW_MS = 5000; // Merge timestamps within 5 seconds of each other

  function deduplicateTimestamps(timestamps) {
    if (timestamps.length === 0) return [];

    // Sort by time
    timestamps.sort((a, b) => a.timeMs - b.timeMs);

    // Group timestamps within the dedup window, keeping the one mentioned most often
    const deduped = [timestamps[0]];
    const counts = [1];

    for (let i = 1; i < timestamps.length; i++) {
      const last = deduped[deduped.length - 1];
      if (Math.abs(timestamps[i].timeMs - last.timeMs) <= DEDUP_WINDOW_MS) {
        // Same jumpscare — increment count, keep the snippet if current one is shorter
        counts[counts.length - 1]++;
      } else {
        deduped.push(timestamps[i]);
        counts.push(1);
      }
    }

    // Add mention count to snippet
    for (let i = 0; i < deduped.length; i++) {
      if (counts[i] > 1) {
        deduped[i].mentions = counts[i];
      }
    }

    return deduped;
  }

  function parseTimestamps(comments) {
    const results = [];

    for (const text of comments) {
      const tsCount = countTimestamps(text);

      if (tsCount < MIN_TIMESTAMPS_FOR_LIST) continue;

      results.push(...extractTimestamps(text));
    }

    const deduped = deduplicateTimestamps(results);
    console.log("[JSD] Comment timestamps:", results.length, "raw ->", deduped.length, "after dedup");
    return deduped;
  }

  return { parseTimestamps };
})();
