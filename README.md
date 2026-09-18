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
