// ISOLATED world orchestrator — extracts heatmap data, fetches comments, merges signals, renders UI

(function () {
  "use strict";

  const MERGE_WINDOW_MS = 10000;
  let currentVideoId = null;

  function mergeSignals(heatmapPeaks, commentTimestamps) {
    const entries = [];

    for (const peak of heatmapPeaks) {
      entries.push({
        timeMs: peak.peakTimeMs,
        endMs: peak.endMs,
        sources: ["heatmap"],
        intensity: peak.intensity,
        zScore: peak.zScore,
        snippet: null,
      });
    }

    for (const ct of commentTimestamps) {
      const nearbyPeak = entries.find(
        (e) => e.sources.includes("heatmap") &&
          Math.abs(e.timeMs - ct.timeMs) <= MERGE_WINDOW_MS
      );

      if (nearbyPeak) {
        if (!nearbyPeak.sources.includes("comment")) {
          nearbyPeak.sources.push("comment");
        }
        if (!nearbyPeak.snippet) {
          nearbyPeak.snippet = ct.snippet;
        }
        if (ct.mentions) {
          nearbyPeak.mentions = ct.mentions;
        }
      } else {
        entries.push({
          timeMs: ct.timeMs,
          endMs: ct.timeMs + 2000,
          sources: ["comment"],
          intensity: null,
          zScore: null,
          mentions: ct.mentions || null,
          snippet: ct.snippet,
        });
      }
    }

    entries.sort((a, b) => a.timeMs - b.timeMs);
    return entries;
  }

  async function fetchCommentsFromPage(videoId) {
    // Get continuation token from the page's ytInitialData
    let token = null;

    // Try wrappedJSObject first (has current page's data on initial load)
    try {
      const ytData = window.wrappedJSObject.ytInitialData;
      if (ytData) {
        // Search for continuation token near comments section
        // Navigate the structure to find it
        const contents = ytData.contents?.twoColumnWatchNextResults?.results?.results?.contents;
        if (contents) {
          for (let i = 0; i < contents.length; i++) {
            try {
              const section = contents[i].itemSectionRenderer;
              if (!section?.contents) continue;
              for (let j = 0; j < section.contents.length; j++) {
                const cont = section.contents[j].continuationItemRenderer
                  ?.continuationEndpoint?.continuationCommand?.token;
                if (cont) {
                  // Verify this is the comments continuation by checking sectionIdentifier
                  const sectionId = section.sectionIdentifier;
                  if (sectionId === "comment-item-section" || !token) {
                    token = cont;
                  }
                }
              }
            } catch (e) {}
          }
        }
      }
    } catch (e) {}

    // Fallback: search the page HTML for the token
    if (!token) {
      try {
        const html = document.documentElement.innerHTML;
        for (const marker of ["comment-item-section", "comments-section"]) {
          const idx = html.indexOf(marker);
          if (idx === -1) continue;
          const nearby = html.substring(Math.max(0, idx - 3000), Math.min(html.length, idx + 3000));
          const m = nearby.match(/"token"\s*:\s*"([^"]{50,})"/);
          if (m) {
            token = m[1];
            break;
          }
        }
      } catch (e) {}
    }

    if (!token) {
      console.log("[JSD] No comments continuation token found");
      return [];
    }

    console.log("[JSD] Found comments token, fetching multiple pages...");

    const allComments = [];
    let nextToken = token;
    const MAX_PAGES = 15; // Fetch up to 15 pages of comments (~300 comments)

    for (let page = 0; page < MAX_PAGES && nextToken; page++) {
      const response = await fetch("https://www.youtube.com/youtubei/v1/next", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          context: {
            client: {
              clientName: "WEB",
              clientVersion: "2.20240101.00.00",
            },
          },
          continuation: nextToken,
        }),
      });

      if (!response.ok) break;

      const data = await response.json();
      nextToken = null; // Reset — look for next continuation token

      // Build entity lookup from mutations
      const commentEntities = {};
      try {
        const mutations = data.frameworkUpdates?.entityBatchUpdate?.mutations || [];
        for (const mutation of mutations) {
          const commentEntity = mutation.payload?.commentEntityPayload;
          if (commentEntity) {
            const key = commentEntity.key || mutation.entityKey;
            const content = commentEntity.properties?.content?.content;
            if (key && content) commentEntities[key] = content;
          }
        }
      } catch (e) {}

      const endpoints = data.onResponseReceivedEndpoints || [];
      for (const endpoint of endpoints) {
        const items = endpoint.reloadContinuationItemsCommand?.continuationItems
          || endpoint.appendContinuationItemsAction?.continuationItems
          || [];

        for (const item of items) {
          // Extract comments
          const thread = item.commentThreadRenderer;
          if (thread) {
            let text = "";
            const viewModel = thread.commentViewModel?.commentViewModel;
            if (viewModel && viewModel.commentKey) {
              text = commentEntities[viewModel.commentKey] || "";
            }
            if (!text) {
              const renderer = thread.comment?.commentRenderer;
              if (renderer) {
                const runs = renderer.contentText?.runs;
                if (runs) text = runs.map((r) => r.text).join("");
                else if (renderer.contentText?.simpleText) text = renderer.contentText.simpleText;
              }
            }
            if (text) allComments.push(text);
          }

          // Look for next page continuation token
          const contToken = item.continuationItemRenderer
            ?.continuationEndpoint?.continuationCommand?.token;
          if (contToken) nextToken = contToken;
        }
      }

      console.log("[JSD] Page", page + 1, ":", allComments.length, "comments so far");
    }

    return allComments;
  }

  async function renderResults(videoId, heatmapPeaks) {
    let commentTimestamps = [];
    try {
      console.log("[JSD] Fetching comments for", videoId);
      const comments = await fetchCommentsFromPage(videoId);
      console.log("[JSD] Got", comments.length, "comments");
      if (comments.length > 0) {
        commentTimestamps = JSD_COMMENTS.parseTimestamps(comments);
        console.log("[JSD] Found", commentTimestamps.length, "comment timestamps from list comments");
      }
    } catch (e) {
      console.warn("[JSD] Comment fetch error:", e);
    }

    const entries = mergeSignals(heatmapPeaks, commentTimestamps);
    console.log("[JSD] Total entries after merge:", entries.length);

    const video = document.querySelector("video");
    const durationMs = video ? video.duration * 1000 : null;

    JSD_UI.cleanup();
    JSD_UI.renderPanel(entries, durationMs);
    if (durationMs) {
      JSD_UI.renderMarkers(entries, durationMs);
    }
    JSD_UI.startLiveWarnings(entries);
  }

  async function processVideo() {
    const urlMatch = window.location.href.match(/[?&]v=([^&]+)/);
    const videoId = urlMatch ? urlMatch[1] : null;

    if (!videoId) return;
    if (videoId === currentVideoId) return;

    // Claim this video ID immediately to prevent duplicate processing
    currentVideoId = videoId;
    console.log("[JSD] New video detected:", videoId);

    // Show loading state immediately
    JSD_UI.cleanup();
    JSD_UI.renderPanel(null, null);

    // Try local extraction first (works on initial page load)
    const data = JSD_BRIDGE.extractHeatmapData();
    if (data && data.heatMarkers && data.heatMarkers.length > 0) {
      console.log("[JSD] Found", data.heatMarkers.length, "markers locally");
      const peaks = JSD_HEATMAP.detectPeaks(data.heatMarkers);
      console.log("[JSD] Detected", peaks.length, "peaks");
      await renderResults(videoId, peaks);
      return;
    }

    // Local extraction failed (SPA navigation) — ask background script to fetch the page
    console.log("[JSD] Local extraction failed, fetching via background script...");
    try {
      const response = await browser.runtime.sendMessage({
        type: "JUMPSCARE_FETCH_HEATMAP",
        videoId,
      });

      // Check we haven't navigated away while waiting
      const currentUrl = window.location.href.match(/[?&]v=([^&]+)/);
      if (!currentUrl || currentUrl[1] !== videoId) return;

      if (response?.heatMarkers?.length > 0) {
        console.log("[JSD] Got", response.heatMarkers.length, "markers from background fetch");
        const peaks = JSD_HEATMAP.detectPeaks(response.heatMarkers);
        console.log("[JSD] Detected", peaks.length, "peaks");
        await renderResults(videoId, peaks);
        return;
      }
    } catch (e) {
      console.warn("[JSD] Background fetch failed:", e);
    }

    // No heatmap data from any source
    console.log("[JSD] No heatmap data found for video", videoId);
    await renderResults(videoId, []);
  }

  // Handle SPA navigation — just call processVideo, it checks the video ID itself
  document.addEventListener("yt-navigate-finish", () => {
    setTimeout(processVideo, 500);
  });

  // Backup: poll for URL changes
  let lastUrl = window.location.href;
  setInterval(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      processVideo();
    }
  }, 1000);

  // Initial run
  setTimeout(processVideo, 1000);
})();
