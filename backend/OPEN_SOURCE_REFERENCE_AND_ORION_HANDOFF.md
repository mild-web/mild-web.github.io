# MILD / AprilVINS upload service: open-source references and Orion handoff

Date: 2026-09-19

This note summarizes open-source systems that are useful references for turning
the current MILD website upload MVP into a long-term AprilVINS service and data
flywheel. The goal is not only to return trajectories to users, but also to
retain user-contributed recordings, curate them, and later use them to improve
AprilVINS/MILD-related models and diagnostics.

## Current local MVP status

The repository currently contains a credential-free local MVP:

```text
static website upload form
→ FastAPI backend
→ local retained upload storage
→ background worker
→ mock or real AprilVINS command template
→ downloadable result package
```

Important files:

- `backend/app/main.py`: upload/status/download API.
- `backend/app/runner.py`: worker entry point; currently supports mock output
  and `APRILVINS_COMMAND_TEMPLATE`.
- `backend/.env.example`: local/cloud/command configuration template.
- `assets/js/upload-runner.js`: website upload client and polling logic.

The MVP already ran a local smoke test with a small zip and produced:

- `trajectory.csv`
- `trajectory_preview.svg`
- `run_log.txt`
- `result_package.zip`

## Open-source references worth borrowing from

### 1. Uppy + tus for robust browser uploads

References:

- Uppy: https://uppy.io/
- Uppy S3 uploads: https://uppy.io/docs/aws-s3/
- Uppy tus uploads: https://uppy.io/docs/tus/
- tus protocol implementations: https://tus.io/implementations

Why it matters for MILD:

- User X5 recordings can be multi-GB. A plain HTML file upload is acceptable for
  a local MVP but fragile for public use.
- Uppy supports a polished upload UI and resumable uploads.
- tus is useful when users lose network connectivity during 10--50 GB uploads.
- Uppy can upload directly to S3-compatible storage such as Cloudflare R2,
  MinIO, DigitalOcean Spaces, or AWS S3, avoiding long browser-to-API proxy
  uploads.

Recommended adoption:

- Keep the current simple upload form for local development.
- For public release, replace the raw `<input type=file>` flow with Uppy.
- Prefer direct-to-object-storage upload with backend-issued signed upload
  requests.

### 2. WebODM / OpenDroneMap as the closest product analogue

References:

- WebODM project: https://github.com/OpenDroneMap/WebODM
- OpenDroneMap project: https://github.com/OpenDroneMap/ODM
- WebODM API upload/task discussion:
  https://community.opendronemap.org/t/importing-images-for-processing-in-webodm-api/8723

Why it matters for MILD:

- WebODM is a mature open-source example of:
  - upload large sensor data,
  - create a processing task,
  - run a heavy computer-vision pipeline,
  - store outputs,
  - let the user download/inspect results.
- Our service is structurally similar, except the processing backend is
  AprilVINS instead of photogrammetry.

Useful design lessons:

- Treat each upload as a reproducible task, not merely as a file.
- Persist metadata, command, logs, and outputs together.
- Always expose status and failure diagnostics.
- Keep processing workers decoupled from the web/API server.
- Later, separate the UI/API from compute workers, similar to how WebODM uses
  processing nodes.

### 3. FastAPI + Celery/RQ/Redis for production job orchestration

References:

- Celery docs: https://docs.celeryq.dev/

Why it matters for MILD:

- The current MVP uses FastAPI `BackgroundTasks`, which is fine for a single
  local process but not robust enough for a public service.
- Long AprilVINS jobs should survive API restarts and should be dispatched to
  dedicated workers.

Recommended migration path:

1. Keep current in-process background jobs for local development.
2. Add a durable job database and a queue:
   - simple stage: SQLite + file locks,
   - production stage: Redis + RQ/Celery,
   - advanced stage: Celery with Redis/RabbitMQ result backend.
3. Add worker states:
   `uploaded → queued → running → postprocessing → succeeded/failed`.
4. Store exact command, config hash, code hash, runtime, and logs for each job.

### 4. MinIO / S3-compatible storage for raw user recordings

References:

- MinIO docs: https://docs.min.io/
- MinIO as S3-compatible object storage:
  https://digitalhub.readthedocs.io/en/latest/source/s3/minio.html

Why it matters for MILD:

- Raw X5 recordings are large and should not live inside the web repo.
- We need object storage for:
  - raw user uploads,
  - derived trajectory outputs,
  - preview videos/SVGs,
  - logs and metadata.
- MinIO is useful for local/private deployment because it exposes an S3-style
  API. Later it can be swapped for Cloudflare R2, AWS S3, or Aliyun OSS.

Recommended adoption:

- Keep local filesystem storage in MVP.
- Add a storage abstraction:
  - `local://...` for development,
  - `s3://bucket/...` for deployment.
- Store raw uploads separately from public results.
- Use lifecycle policies for temporary public result links, but retain raw data
  only under explicit consent.

### 5. Label Studio / CVAT / FiftyOne for data curation

References:

- Label Studio docs: https://labelstud.io/
- CVAT: https://www.cvat.ai/
- FiftyOne docs: https://docs.voxel51.com/

Why it matters for MILD:

- User uploads probably do not include ground truth. They are still valuable for:
  - diversity analysis,
  - failure mining,
  - sensor-condition clustering,
  - tag visibility diagnostics,
  - qualitative retrieval,
  - self-supervised training candidates.
- We need a way to inspect, group, and flag uploaded data rather than just store
  it blindly.

Recommended adoption:

- Use FiftyOne-like concepts for dataset inspection:
  - sample,
  - tags,
  - metadata,
  - embeddings,
  - similarity search,
  - failure categories.
- Use Label Studio/CVAT only if manual event/tag/occlusion annotations become
  necessary.
- Do not require annotation for the first service version.

### 6. DVC or lakeFS-style versioning for dataset snapshots

References:

- DVC docs: https://dvc.org/doc

Why it matters for MILD:

- A user-contributed dataset will evolve. We need reproducible snapshots:
  - `raw_uploads_v0`,
  - `accepted_uploads_v1`,
  - `failure_cases_v1`,
  - `self_supervised_candidates_v1`.
- Paper/release claims should point to frozen snapshots, not a moving folder.

Recommended adoption:

- For local research iteration, DVC is sufficient and easy.
- For a larger hosted data lake, lakeFS or object-store versioning may be more
  appropriate.

## Suggested long-term architecture

```text
Browser
  ├─ Uppy upload UI
  └─ status/result viewer

API service
  ├─ authentication / consent / metadata
  ├─ signed upload URL generation
  ├─ job creation and status API
  └─ result download URL generation

Object storage
  ├─ raw_uploads/{job_id}/...
  ├─ processed/{job_id}/trajectory.csv
  ├─ processed/{job_id}/preview.*
  └─ processed/{job_id}/logs.json

Queue
  ├─ uploaded job
  └─ AprilVINS processing job

Worker
  ├─ unpack X5 upload
  ├─ validate format
  ├─ run AprilVINS
  ├─ generate trajectory preview
  ├─ generate quality diagnostics
  └─ upload result package

Dataset curation
  ├─ accepted / failed / interesting / private flags
  ├─ condition metadata
  ├─ failure mining
  └─ self-supervised candidate selection
```

## Minimum upload package format Orion should define

Orion should define one canonical sample zip for the first real test:

```text
upload.zip
  metadata.json
  calibration/
    x5_config.yaml
    camera_imu.yaml
  data/
    front_or_pano_video.*
    back_video.*              # if needed by the selected pipeline
    imu.csv or imu.bag
  tags/
    tag_size.txt or tags.yaml
```

Questions Orion must settle:

1. Can users upload only raw Insta360 X5 video, or do we require extracted
   fisheye streams and IMU?
2. Which calibration/config file can be reused for X5?
3. How is tag size supplied?
4. Are tag IDs detected automatically?
5. What output trajectory is returned:
   - AprilVINS full/promoted,
   - raw VIO,
   - tag-pose prior,
   - diagnostics?
6. What failure categories should be exposed to users?

## Data flywheel vision

The long-term value is not only a trajectory service. The service can become a
data flywheel:

```text
users upload X5 data
→ AprilVINS returns trajectory and diagnostics
→ system retains consented raw data
→ curator mines failures and hard cases
→ model/pipeline improves
→ better service attracts more uploads
```

Since most user uploads will not have robot TCP ground truth, they may not
directly support supervised metric evaluation. They are still useful for:

- self-supervised visual-inertial consistency,
- tag reprojection consistency,
- loop/trajectory smoothness constraints,
- completion and gap diagnostics,
- domain diversity mining,
- detecting X5 exposure/motion blur/tag visibility failure modes,
- learning better gating/failure predictors.

Future self-supervised signals to explore:

1. AprilTag geometric consistency across frames.
2. Multi-view/fisheye temporal reprojection consistency.
3. IMU preintegration residual consistency.
4. Forward/backward trajectory agreement.
5. Sliding-window uncertainty vs. observed failure patterns.
6. Agreement between raw VIO, tag-pose prior, and promoted output.
7. Automatic mining of sequences where the output gate rejects large chunks.

## Orion immediate task

Orion should not start with cloud deployment. First prove a local real-data
closed loop:

1. Pick one short local MILD Insta360 X5 sequence that is already known to run
   with the final AprilVINS pipeline.
2. Package it into the canonical upload zip.
3. Start the backend:

   ```bash
   PYTHONPATH=/tmp/mild_backend_deps:. python3 -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
   ```

4. Configure `APRILVINS_COMMAND_TEMPLATE` in `backend/.env`.
5. Upload the package through `/api/jobs` or the website form.
6. Verify:
   - backend stores the input,
   - worker runs real AprilVINS,
   - result package contains trajectory, preview, log, and metadata,
   - website shows downloadable artifacts.
7. Report the exact command, input package structure, outputs, and remaining
   blockers.

Stop condition:

- At least one local MILD X5 sequence produces a real AprilVINS trajectory via
  the backend upload pipeline; or Orion identifies the exact missing interface
  between uploaded data and the current AprilVINS runner.

## Manual ROI-gated prompt for Orion

Use this only after the user/current manually starts Orion. Do not run an
autonomous loop.

```text
orion：这是 MILD/AprilVINS website upload-service 的手动 ROI-gated 任务，不是自动循环。

Deliverable:
1. 建立一个 canonical X5 upload.zip 样例，使用一条已知可跑通的本地 MILD Insta360 X5 序列；
2. 将当前 website backend 的 APRILVINS_COMMAND_TEMPLATE 接到真实 AprilVINS runner；
3. 通过本地 /api/jobs 或网页上传接口跑通一次真实 AprilVINS 处理；
4. 输出一个 run record，包含输入 zip 结构、真实命令、配置文件、输出文件、日志、失败/成功状态、下一步 blocker。

Paper / project value:
- 证明网站不仅是展示页，而是可以变成“用户上传 X5 数据 → 返回 AprilVINS 轨迹/诊断”的服务入口；
- 为后续收集用户数据、构建无真值 self-supervised 数据库和失败案例库打通第一条闭环。

Scope:
- 只做本地闭环，不申请云服务器、不接真实云存储、不上传用户隐私数据；
- 不修改公开网页文案，除非是为了修复本地 upload API 调用；
- 不把 raw upload、runtime jobs、token、.env 推入 git。

Required references:
- backend/README.md
- backend/.env.example
- backend/OPEN_SOURCE_REFERENCE_AND_ORION_HANDOFF.md
- 当前 AprilVINS final/orion runner 相关 README、manifest、config。

Suggested command skeleton:
PYTHONPATH=/tmp/mild_backend_deps:. python3 -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000

Stop condition:
- 成功：一条真实 MILD X5 upload.zip 经 backend 生成 AprilVINS trajectory/result.zip；
- 或失败：明确指出 upload package 与 AprilVINS runner 之间缺少哪一个接口/文件/配置，给出最小修复建议。

Budget:
- 最多 2 轮 Orion 回答；
- 第一轮不超过 6000 tokens；
- 不跑超过 30 分钟的长任务，除非 current 手动批准。
```
