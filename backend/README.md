# MILD upload backend MVP

This backend is the first automated upload/processing service for the MILD
project page. It is designed to run without cloud credentials first, then switch
to cloud storage or a real AprilVINS command later through environment variables.

## What works in the first version

- `POST /api/jobs`: upload an Insta360 X5 recording archive with user consent.
- Local retention of the raw uploaded data under `backend/runtime/jobs/`.
- Background processing job with status polling.
- Dry-run/mock output if no real AprilVINS command is configured.
- Result package download containing:
  - `trajectory.csv`
  - `trajectory_preview.svg`
  - `run_log.txt`
  - `job_metadata.json`

## Local quick start

```bash
cd /media/zjj/Elements/CQU_ZJJ/UMID/Paper/mild_web_github_pages_20260912
python3 -m venv backend/.venv
source backend/.venv/bin/activate
pip install -r backend/requirements.txt
cp backend/.env.example backend/.env
uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 --reload
```

Then open the static page and set the API endpoint to:

```text
http://127.0.0.1:8000
```

## Connecting the real AprilVINS runner

Set `APRILVINS_COMMAND_TEMPLATE` in `backend/.env`. The backend will pass the
uploaded archive path, job directory, output directory, tag size, and sensor
route to the command. If the command exits with a non-zero return code, the job
is marked as failed and the log is retained.

Example:

```env
APRILVINS_COMMAND_TEMPLATE=/opt/aprilvins/run_x5.sh --input {input_file} --output {output_dir} --tag-size {tag_size_m}
```

The command should write final artifacts into `{output_dir}`. The backend will
package the output directory into a downloadable zip.

## Data retention notice

The web UI requires users to confirm that uploaded recordings may be stored and
used by the project team to improve AprilVINS and MILD-related research tools.
Do not deploy this service publicly without retaining that consent text and
without deciding a deletion/contact policy.

