# youtube-video-jumpscare-detection-browser-extension

## Purpose
I was watching scary game let's plays on YouTube but I kept getting scared by all of the jumpscares, and I've realized that most of the time, whenever there's a jumpscare or scary moment in general, the YouTube seek bar would show a mountain-like heatmap, so I've built this browser extension for Firefox to list out these points to give myself a heads-up before a jumpscare occurs. 

## Features
- Heatmap spike detection using YouTube's engagement data
- Comment scanning to find jumpscare timestamp lists from other viewers (comments with 3+ timestamps)
- Live warning toast that pops up on the video a few seconds before a detected jumpscare
- Sidebar panel with clickable timestamps showing source (H = heatmap, C = comments, H+C = both)
- Color-coded seek bar markers (red = heatmap, blue = comments, purple = both)
- Works across video navigation without page reload

## How It Works

### Heatmap Detection
YouTube generates engagement heatmaps for videos with ~50K+ views. The extension reads this data and runs a modified z-score algorithm to find statistically significant spikes above the baseline. These spikes often correspond to jumpscares.

### Comment Detection
Fetches up to 300 comments via YouTube's internal API (`youtubei/v1/next` with continuation tokens). Identifies comments containing 3 or more timestamps, which are almost always jumpscare/scary moment lists posted by other viewers. Duplicate timestamps from multiple comments are merged within a 5-second window, with a count of how many commenters flagged each moment.

### Signal Merging
When a comment timestamp falls within 10 seconds of a heatmap peak, they merge into a single high-confidence entry (purple H+C badge).

## Installation

### Permanent Install
1. Zip the extension files (`manifest.json`, `background.js`, `content/`, `icons/`)
2. Go to [addons.mozilla.org/developers](https://addons.mozilla.org/developers/) and sign in
3. Submit as "On your own" (self-distribution) — Mozilla signs it and returns a `.xpi` file
4. Open the `.xpi` in Firefox to install permanently

### Temporary Install (Development)
1. Open `about:debugging#/runtime/this-firefox` in Firefox
2. Click "Load Temporary Add-on" and select `manifest.json`

## Requirements & Limitations

- Firefox only (Manifest V3, requires Firefox 109+)
- No API key needed
- Heatmap data requires ~50K+ views on the video
- Comment detection depends on viewers having posted timestamp lists
- Detects *potential* jumpscares (not every spike is a jumpscare)