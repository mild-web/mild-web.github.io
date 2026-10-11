#!/usr/bin/env python3
"""Reuse an existing trajectory renderer for explicit, provenance-backed jobs.

No estimator is run and no benchmark metric is recalculated. The input plan
and the renderer path are supplied locally; private source paths are not
included in the public website manifest.
"""
import argparse
from concurrent.futures import ProcessPoolExecutor, as_completed
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sys

RENDERER = None


def initialize(renderer_path, output_root):
    global RENDERER
    import matplotlib
    matplotlib.use("Agg")
    renderer_path = Path(renderer_path)
    sys.path.insert(0, str(renderer_path.parent))
    spec = importlib.util.spec_from_file_location("comparison_original_renderer", renderer_path)
    RENDERER = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = RENDERER
    spec.loader.exec_module(RENDERER)
    RENDERER.OUT_DIR = Path(output_root)
    writer = RENDERER.FFMpegWriter

    def bounded_writer(*args, **kwargs):
        kwargs["extra_args"] = [*kwargs.get("extra_args", []), "-threads", "2"]
        return writer(*args, **kwargs)

    RENDERER.FFMpegWriter = bounded_writer


def render(job):
    fields = dict(job["render"])
    fields["trajectory_path"] = Path(fields["trajectory_path"])
    fields["gt_path"] = Path(fields["gt_path"])
    spec = RENDERER.RouteVideoSpec(**fields)
    result = RENDERER.render_video(spec)
    if result["render_status"] != "rendered":
        raise RuntimeError(f"Unexpected rendering failure: {spec.task_slug}/{spec.method_slug}: {result['note']}")
    for source, target in [(result["output_mp4"], job["target_video"]),
                           (result["poster_png"], job["target_poster"])]:
        target = Path(target)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
    return {"task_slug": spec.task_slug, "method_slug": spec.method_slug,
            "event_count": result["event_count"], "event_planes": result["event_zoom_projection_planes"],
            "associations": result["alignment_associations"], "status": "rendered"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", required=True)
    parser.add_argument("--renderer", required=True)
    parser.add_argument("--output-root", required=True)
    parser.add_argument("--workers", type=int, default=2)
    args = parser.parse_args()
    jobs = json.loads(Path(args.plan).read_text())["jobs"]
    with ProcessPoolExecutor(max_workers=max(1, min(args.workers, 2)),
                             initializer=initialize, initargs=(args.renderer, args.output_root)) as pool:
        futures = [pool.submit(render, job) for job in jobs]
        for future in as_completed(futures):
            print(json.dumps(future.result()), flush=True)


if __name__ == "__main__":
    os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
    os.environ.setdefault("OMP_NUM_THREADS", "1")
    main()
