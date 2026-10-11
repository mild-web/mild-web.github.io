# MILD

Anonymous review project page for:

**MILD: Benchmarking Manipulation-Interface Localization with
AprilTag-Assisted Visual-Inertial Estimation**

This repository currently hosts a static GitHub Pages draft. Author names,
affiliations, personal links, and non-anonymous repository links are intentionally
omitted during review.

The current page provides supplementary material for the paper, including
real-world task videos, synchronized sensor views, scene-condition variants,
and qualitative trajectory examples that cannot fit in the manuscript.

The replay-event videos are visualization assets only: they show recorded
gripper-event neighborhoods and trajectory localization offsets, but do not
simulate object motion or physical replay success.

## Synchronized localization comparison

Each task row has a shared play/pause button, seek bar, restart button, and
playback-speed selector. The pinned task column includes a full-recording
scene preview and a selector for the available AprilTag4, ArUco4, and sensor
recordings. Insight9 scene previews are rotated 180 degrees for display.

The 16-second presentation clock maps each trajectory clip back to its
original reference-relative time range. Late-starting and short trajectories
are not stretched to appear complete. Clips from the same recording follow
the same source time; different scene/sensor recordings share normalized
reference progress, not absolute timestamps. Loading pauses the row clock;
off-screen videos pause and rejoin that clock when they become visible.
The existing metrics and black Fail clips are unchanged.

Validation: `node --test tests/replay-sync.test.cjs`. The optional browser
regression check uses an installed Chrome without adding npm dependencies:
`node scripts/check-replay-browser.mjs /tmp/mild-comparison-check`.

`scripts/prepare-replay-sync.mjs` recovers the timestamp maps from the original
render CSV, sensor-preview manifests, and SDK time-offset CSV. Its `--patch`
mode emits an apply_patch patch; `--build-scenes` generates the video assets.
Neither mode recalculates paper metrics.

## Upload/processing MVP

The repository also contains a first local backend MVP under `backend/` for an
automated user-upload pipeline:

```text
Website upload form
→ FastAPI backend
→ local retained upload storage
→ AprilVINS command template or mock worker
→ downloadable trajectory/result package
```

It is intentionally credential-free by default. Copy `backend/.env.example` to
`backend/.env` later to configure cloud storage or a real AprilVINS command.
See `backend/README.md` for local startup instructions.
