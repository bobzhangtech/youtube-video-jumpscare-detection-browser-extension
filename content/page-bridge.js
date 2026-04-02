// Heatmap data extraction — runs in ISOLATED world
// Uses Firefox's wrappedJSObject to safely read YouTube's page-level JS variables

const JSD_BRIDGE = (() => {
  "use strict";

  function readPrimitive(obj, key) {
    try {
      const val = obj[key];
      if (val === undefined || val === null) return val;
      const t = typeof val;
      if (t === "string" || t === "number" || t === "boolean") return val;
      return undefined;
    } catch (e) {
      return undefined;
    }
  }

  function navigate(obj, path) {
    try {
      let current = obj;
      for (const key of path) {
        if (!current || typeof current !== "object") return null;
        current = current[key];
      }
      return current;
    } catch (e) {
      return null;
    }
  }

  function extractMarkersFromHeatseeker(markersMap) {
    let len;
    try { len = markersMap.length; } catch (e) { return null; }
    if (!len) return null;

    for (let i = 0; i < len; i++) {
      try {
        const entry = markersMap[i];
        const key = readPrimitive(entry, "key");

        if (key === "HEATSEEKER") {
          const heatMarkers = navigate(entry, ["value", "heatmap", "heatmapRenderer", "heatMarkers"]);
          if (!heatMarkers) continue;

          let markerCount;
          try { markerCount = heatMarkers.length; } catch (e) { continue; }
          if (!markerCount) continue;

          const parsed = [];
          for (let j = 0; j < markerCount; j++) {
            try {
              const renderer = heatMarkers[j].heatMarkerRenderer;
              const intensity = readPrimitive(renderer, "heatMarkerIntensityScoreNormalized");
              const startMs = readPrimitive(renderer, "timeRangeStartMillis");
              const durationMs = readPrimitive(renderer, "markerDurationMillis");
              if (intensity !== undefined && startMs !== undefined) {
                parsed.push({ intensity, startMs, durationMs });
              }
            } catch (e) {}
          }
          if (parsed.length > 0) return parsed;
        }

        // Entity-based heatmap format (mutations path)
        const payload = navigate(entry, ["payload", "macroMarkersListEntity", "markersList", "markers"]);
        if (payload) {
          let payloadLen;
          try { payloadLen = payload.length; } catch (e) { continue; }

          const parsed = [];
          for (let j = 0; j < payloadLen; j++) {
            try {
              const m = payload[j];
              const intensity = readPrimitive(m, "intensityScoreNormalized");
              const startMs = readPrimitive(m, "startMillis");
              const durationMs = readPrimitive(m, "durationMillis");
              if (intensity !== undefined && startMs !== undefined) {
                parsed.push({ intensity, startMs, durationMs });
              }
            } catch (e) {}
          }
          if (parsed.length > 0) return parsed;
        }
      } catch (e) {}
    }

    return null;
  }

  function extractFromObject(obj) {
    if (!obj) return null;

    // All known paths where heatmap markers may live
    const paths = [
      ["playerOverlays", "playerOverlayRenderer", "decoratedPlayerBarRenderer",
       "decoratedPlayerBarRenderer", "playerBar", "multiMarkersPlayerBarRenderer", "markersMap"],
      ["playerOverlays", "playerOverlayRenderer", "decoratedPlayerBarRenderer",
       "playerBar", "multiMarkersPlayerBarRenderer", "markersMap"],
      ["frameworkUpdates", "entityBatchUpdate", "mutations"],
    ];

    for (const path of paths) {
      const markersMap = navigate(obj, path);
      if (!markersMap) continue;
      const result = extractMarkersFromHeatseeker(markersMap);
      if (result) return result;
    }

    return null;
  }

  function getVideoIdFromUrl() {
    const match = window.location.href.match(/[?&]v=([^&]+)/);
    return match ? match[1] : null;
  }

  function getVideoIdFromResponse(response) {
    try {
      return readPrimitive(navigate(response, ["videoDetails"]), "videoId");
    } catch (e) {
      return null;
    }
  }

  function extractHeatmapData() {
    const videoId = getVideoIdFromUrl();
    if (!videoId) {
      console.log("[JSD] Not a video page");
      return null;
    }

    // Source 1: Try the movie player's internal API (works after SPA navigation)
    try {
      const player = document.getElementById("movie_player");
      if (player && player.wrappedJSObject) {
        // Try getPlayerResponse() method
        if (typeof player.wrappedJSObject.getPlayerResponse === "function") {
          const playerResponse = player.wrappedJSObject.getPlayerResponse();
          if (playerResponse) {
            const responseVideoId = getVideoIdFromResponse(playerResponse);
            if (responseVideoId === videoId) {
              const heatMarkers = extractFromObject(playerResponse);
              if (heatMarkers) {
                console.log("[JSD] Found", heatMarkers.length, "markers via player API");
                return { videoId, heatMarkers };
              }
            }
          }
        }
      }
    } catch (e) {
      console.warn("[JSD] Error reading player API:", e);
    }

    // Source 2: Try ytInitialPlayerResponse (works on initial page load)
    try {
      const response = window.wrappedJSObject.ytInitialPlayerResponse;
      if (response) {
        const responseVideoId = getVideoIdFromResponse(response);
        // Only use if it matches the current video
        if (responseVideoId === videoId) {
          const heatMarkers = extractFromObject(response);
          if (heatMarkers) {
            console.log("[JSD] Found markers via ytInitialPlayerResponse");
            return { videoId, heatMarkers };
          }
        } else {
          console.log("[JSD] ytInitialPlayerResponse is stale (has", responseVideoId, "want", videoId, ")");
        }
      }
    } catch (e) {
      console.warn("[JSD] Error reading ytInitialPlayerResponse:", e);
    }

    // Source 3: Try ytInitialData
    try {
      const data = window.wrappedJSObject.ytInitialData;
      if (data) {
        const heatMarkers = extractFromObject(data);
        if (heatMarkers) {
          console.log("[JSD] Found markers via ytInitialData");
          return { videoId, heatMarkers };
        }
      }
    } catch (e) {
      console.warn("[JSD] Error reading ytInitialData:", e);
    }

    // Source 4: Try to find heatmap data in page HTML (initial load only)
    try {
      const html = document.documentElement.innerHTML;
      const idx = html.indexOf("heatMarkerRenderer");
      if (idx !== -1) {
        const searchStart = Math.max(0, idx - 5000);
        const searchEnd = Math.min(html.length, idx + 50000);
        const chunk = html.substring(searchStart, searchEnd);

        const arrayMatch = chunk.match(/"heatMarkers"\s*:\s*(\[.+?\])\s*\}/);
        if (arrayMatch) {
          const heatMarkers = JSON.parse(arrayMatch[1]);
          console.log("[JSD] Found", heatMarkers.length, "markers in page HTML");
          const parsed = heatMarkers.map((m) => ({
            intensity: m.heatMarkerRenderer.heatMarkerIntensityScoreNormalized,
            startMs: m.heatMarkerRenderer.timeRangeStartMillis,
            durationMs: m.heatMarkerRenderer.markerDurationMillis,
          }));
          return { videoId, heatMarkers: parsed };
        }
      }
    } catch (e) {
      console.warn("[JSD] Error searching page HTML:", e);
    }

    console.log("[JSD] No heatmap data found for video", videoId);
    return { videoId, heatMarkers: null };
  }

  return { extractHeatmapData };
})();
