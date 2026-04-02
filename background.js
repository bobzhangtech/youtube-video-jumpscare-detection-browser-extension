// Background service worker — fetches YouTube comments and heatmap data

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "JUMPSCARE_FETCH_COMMENTS") {
    fetchComments(message.videoId)
      .then((comments) => sendResponse({ comments }))
      .catch((err) => sendResponse({ comments: [], error: err.message }));
    return true;
  }

  if (message.type === "JUMPSCARE_FETCH_HEATMAP") {
    fetchHeatmap(message.videoId)
      .then((heatMarkers) => sendResponse({ heatMarkers }))
      .catch((err) => {
        console.warn("[JSD bg] Heatmap fetch error:", err);
        sendResponse({ heatMarkers: null });
      });
    return true;
  }

  return false;
});

// Extract a JSON array starting at position `start` in `text` by counting brackets
function extractJsonArray(text, start) {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "[") depth++;
    else if (text[i] === "]") {
      depth--;
      if (depth === 0) {
        return text.substring(start, i + 1);
      }
    }
  }
  return null;
}

async function fetchHeatmap(videoId) {
  const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    credentials: "omit",
    headers: {
      "Accept-Language": "en",
    },
  });

  if (!response.ok) return null;

  const html = await response.text();

  // Strategy 1: Look for "heatMarkers":[ in the HTML
  const heatMarkersKey = '"heatMarkers"';
  let idx = html.indexOf(heatMarkersKey);
  if (idx !== -1) {
    // Find the opening bracket of the array
    const arrayStart = html.indexOf("[", idx + heatMarkersKey.length);
    if (arrayStart !== -1) {
      const arrayStr = extractJsonArray(html, arrayStart);
      if (arrayStr) {
        try {
          const heatMarkers = JSON.parse(arrayStr);
          if (heatMarkers.length > 0 && heatMarkers[0].heatMarkerRenderer) {
            console.log("[JSD bg] Found", heatMarkers.length, "heatMarkers for", videoId);
            return heatMarkers.map((m) => ({
              intensity: m.heatMarkerRenderer.heatMarkerIntensityScoreNormalized,
              startMs: m.heatMarkerRenderer.timeRangeStartMillis,
              durationMs: m.heatMarkerRenderer.markerDurationMillis,
            }));
          }
        } catch (e) {
          console.warn("[JSD bg] Failed to parse heatMarkers JSON:", e.message);
        }
      }
    }
  }

  // Strategy 2: Look for entity-based format with intensityScoreNormalized
  idx = html.indexOf("intensityScoreNormalized");
  if (idx !== -1) {
    // Search backwards for the opening bracket of the markers array
    const searchStart = Math.max(0, idx - 200);
    const bracketIdx = html.lastIndexOf("[", idx);
    if (bracketIdx >= searchStart) {
      const arrayStr = extractJsonArray(html, bracketIdx);
      if (arrayStr) {
        try {
          const markers = JSON.parse(arrayStr);
          if (markers.length > 0 && markers[0].intensityScoreNormalized !== undefined) {
            console.log("[JSD bg] Found", markers.length, "entity markers for", videoId);
            return markers.map((m) => ({
              intensity: m.intensityScoreNormalized,
              startMs: m.startMillis,
              durationMs: m.durationMillis,
            }));
          }
        } catch (e) {}
      }
    }
  }

  console.log("[JSD bg] No heatmap data found in page HTML for", videoId);
  return null;
}

async function fetchComments(videoId) {
  try {
    // Step 1: Fetch the watch page to get the continuation token for comments
    console.log("[JSD bg] Fetching page for comments token...", videoId);
    const pageResponse = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      credentials: "omit",
      headers: { "Accept-Language": "en" },
    });

    if (!pageResponse.ok) {
      console.log("[JSD bg] Page fetch failed:", pageResponse.status);
      return [];
    }

    const html = await pageResponse.text();

    // Find continuation token for comments
    // Look for the token near "comment-item-section" or "comments-section"
    let token = null;

    for (const marker of ["comment-item-section", "comments-section", "commentsSectionRenderer"]) {
      const markerIdx = html.indexOf(marker);
      if (markerIdx === -1) continue;

      // Search nearby (before and after) for a continuation token
      const searchStart = Math.max(0, markerIdx - 3000);
      const searchEnd = Math.min(html.length, markerIdx + 3000);
      const nearby = html.substring(searchStart, searchEnd);

      const tokenMatch = nearby.match(/"token"\s*:\s*"([^"]{50,})"/);
      if (tokenMatch) {
        token = tokenMatch[1];
        console.log("[JSD bg] Found continuation token via", marker);
        break;
      }
    }

    if (!token) {
      // Broader search — find any continuation token related to comments
      const broadMatch = html.match(/"continuation"\s*:\s*"(Eg[^"]{50,})"/);
      if (broadMatch) {
        token = broadMatch[1];
        console.log("[JSD bg] Found continuation token via broad search");
      }
    }

    if (!token) {
      console.log("[JSD bg] No comments continuation token found for", videoId);
      return [];
    }

    // Step 2: Fetch comments using the continuation token
    console.log("[JSD bg] Fetching comments with continuation token...");
    const commentsResponse = await fetch("https://www.youtube.com/youtubei/v1/next", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        context: {
          client: {
            clientName: "WEB",
            clientVersion: "2.20240101.00.00",
          },
        },
        continuation: token,
      }),
    });

    if (!commentsResponse.ok) {
      console.log("[JSD bg] Comments API returned:", commentsResponse.status);
      return [];
    }

    const commentsData = await commentsResponse.json();
    const comments = [];

    const endpoints = commentsData.onResponseReceivedEndpoints || [];
    for (const endpoint of endpoints) {
      const items = endpoint.reloadContinuationItemsCommand?.continuationItems
        || endpoint.appendContinuationItemsAction?.continuationItems
        || [];

      for (const item of items) {
        const thread = item.commentThreadRenderer;
        if (!thread) continue;

        const runs = thread.comment?.commentRenderer?.contentText?.runs;
        if (!runs) continue;

        const text = runs.map((r) => r.text).join("");
        if (text) comments.push(text);
      }
    }

    console.log("[JSD bg] Fetched", comments.length, "comments for", videoId);
    return comments;
  } catch (e) {
    console.warn("[JSD bg] Comment fetch error:", e);
    return [];
  }
}
