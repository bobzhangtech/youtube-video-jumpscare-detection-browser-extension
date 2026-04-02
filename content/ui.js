// UI rendering — overlay panel and timeline markers

const JSD_UI = (() => {
  "use strict";

  function formatTime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    }
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }

  function seekTo(timeMs) {
    const video = document.querySelector("video");
    if (video) {
      // Seek to 5 seconds before the peak for a heads-up
      video.currentTime = Math.max(0, timeMs / 1000 - 5);
    }
  }

  function getSourceLabel(sources) {
    if (sources.includes("heatmap") && sources.includes("comment")) return "both";
    if (sources.includes("comment")) return "comment";
    return "heatmap";
  }

  function getSourceColor(sources) {
    if (sources.includes("heatmap") && sources.includes("comment")) return "var(--jsd-purple)";
    if (sources.includes("comment")) return "var(--jsd-blue)";
    return "var(--jsd-red)";
  }

  function renderPanel(entries, durationMs) {
    // Find the sidebar to inject into
    const sidebar = document.querySelector("#secondary") || document.querySelector("#below");
    if (!sidebar) return;

    const panel = document.createElement("div");
    panel.id = "jsd-panel";
    panel.className = "jsd-panel";

    // Header
    const header = document.createElement("div");
    header.className = "jsd-header";

    const title = document.createElement("span");
    title.className = "jsd-title";
    title.textContent = "Jumpscare Detector";

    const toggleBtn = document.createElement("button");
    toggleBtn.className = "jsd-toggle";
    toggleBtn.textContent = "Hide";
    toggleBtn.addEventListener("click", () => {
      const body = panel.querySelector(".jsd-body");
      const isHidden = body.style.display === "none";
      body.style.display = isHidden ? "" : "none";
      toggleBtn.textContent = isHidden ? "Hide" : "Show";
    });

    header.appendChild(title);
    header.appendChild(toggleBtn);
    panel.appendChild(header);

    // Body
    const body = document.createElement("div");
    body.className = "jsd-body";

    if (entries === null) {
      // Loading state
      const loading = document.createElement("div");
      loading.className = "jsd-empty jsd-loading";
      loading.textContent = "Scanning for potential jumpscares...";
      body.appendChild(loading);
    } else if (entries.length === 0) {
      const empty = document.createElement("div");
      empty.className = "jsd-empty";
      empty.textContent = "No potential jumpscares detected for this video.";
      body.appendChild(empty);
    } else {
      const list = document.createElement("ul");
      list.className = "jsd-list";

      for (const entry of entries) {
        const li = document.createElement("li");
        li.className = "jsd-item";

        const sourceType = getSourceLabel(entry.sources);

        // Source badge
        const badge = document.createElement("span");
        badge.className = `jsd-badge jsd-badge-${sourceType}`;
        badge.textContent = sourceType === "both" ? "H+C" : sourceType === "heatmap" ? "H" : "C";
        badge.title = sourceType === "both" ? "Heatmap + Comment" : sourceType === "heatmap" ? "Heatmap" : "Comment";

        // Timestamp link
        const timeLink = document.createElement("a");
        timeLink.className = "jsd-timestamp";
        timeLink.textContent = formatTime(entry.timeMs);
        timeLink.href = "#";
        timeLink.addEventListener("click", (e) => {
          e.preventDefault();
          seekTo(entry.timeMs);
        });

        // Info
        const info = document.createElement("span");
        info.className = "jsd-info";
        const infoParts = [];
        if (entry.intensity !== null) {
          infoParts.push(`Intensity: ${(entry.intensity * 100).toFixed(0)}%`);
        }
        if (entry.mentions && entry.mentions > 1) {
          infoParts.push(`${entry.mentions} comments`);
        }
        info.textContent = infoParts.join(" | ");
        if (entry.snippet) {
          const snippetEl = document.createElement("span");
          snippetEl.className = "jsd-snippet";
          snippetEl.textContent = entry.snippet;
          info.appendChild(snippetEl);
        }

        li.appendChild(badge);
        li.appendChild(timeLink);
        li.appendChild(info);
        list.appendChild(li);
      }

      body.appendChild(list);
    }

    panel.appendChild(body);
    sidebar.insertBefore(panel, sidebar.firstChild);
  }

  function renderMarkers(entries, durationMs) {
    if (!durationMs || durationMs <= 0) return;

    const progressBar = document.querySelector(".ytp-progress-bar-container");
    if (!progressBar) return;

    for (const entry of entries) {
      const marker = document.createElement("div");
      marker.className = "jsd-marker";

      const leftPct = (entry.timeMs / durationMs) * 100;

      marker.style.left = `${leftPct}%`;
      marker.style.width = "3px";
      marker.style.backgroundColor = getSourceColor(entry.sources);

      const sourceType = getSourceLabel(entry.sources);
      marker.title = `Potential jumpscare at ${formatTime(entry.timeMs)} (${sourceType})`;

      progressBar.appendChild(marker);
    }
  }

  // ── Live Warning System ──

  const WARN_AHEAD_SEC = 8;
  let warnInterval = null;
  let warnedSet = new Set();
  let activeEntries = [];

  function startLiveWarnings(entries) {
    stopLiveWarnings();
    activeEntries = entries;
    warnedSet = new Set();

    const video = document.querySelector("video");
    if (!video || entries.length === 0) return;

    warnInterval = setInterval(() => {
      if (video.paused) return;

      const currentMs = video.currentTime * 1000;

      for (const entry of activeEntries) {
        if (warnedSet.has(entry.timeMs)) continue;

        const diff = entry.timeMs - currentMs;
        if (diff > 0 && diff <= WARN_AHEAD_SEC * 1000) {
          warnedSet.add(entry.timeMs);
          showWarningToast(entry, Math.round(diff / 1000));
        }
      }
    }, 500);
  }

  function stopLiveWarnings() {
    if (warnInterval) {
      clearInterval(warnInterval);
      warnInterval = null;
    }
    activeEntries = [];
    warnedSet = new Set();
  }

  function showWarningToast(entry, secondsAway) {
    // Remove any existing toast
    const existing = document.querySelector("#jsd-toast");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.id = "jsd-toast";
    toast.className = "jsd-toast";

    const icon = document.createElement("span");
    icon.className = "jsd-toast-icon";
    icon.textContent = "!";

    const text = document.createElement("span");
    text.className = "jsd-toast-text";
    text.textContent = `Potential jumpscare in ~${secondsAway}s (at ${formatTime(entry.timeMs)})`;

    toast.appendChild(icon);
    toast.appendChild(text);

    // Inject into the video player
    const player = document.querySelector("#movie_player") || document.querySelector("#player");
    if (player) {
      player.appendChild(toast);
    } else {
      document.body.appendChild(toast);
    }

    // Fade out after 6 seconds
    setTimeout(() => {
      toast.classList.add("jsd-toast-fade");
      setTimeout(() => toast.remove(), 600);
    }, 6000);
  }

  function cleanup() {
    stopLiveWarnings();
    document.querySelectorAll("#jsd-panel, .jsd-marker, #jsd-toast").forEach((el) => el.remove());
  }

  return { renderPanel, renderMarkers, startLiveWarnings, cleanup };
})();
