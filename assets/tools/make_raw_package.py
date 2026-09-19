#!/usr/bin/env python3
"""Package an X5 SDK recording without GT, robot logs, or historical estimates.

Standalone helper: Python 3, standard library only.
"""
import argparse
import json
from pathlib import Path
import zipfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw", required=True, type=Path, help="SDK folder with stream_0.h264, video_packets.csv and imu.csv")
    parser.add_argument("--calibration", required=True, type=Path, help="Folder with cam0.yaml, cam1.yaml and extrinsics.yaml")
    parser.add_argument("--calibration-description", required=True)
    parser.add_argument("--camera-imu-td", required=True, type=float, help="Calibrated camera-to-IMU offset in seconds")
    parser.add_argument("--tag-size", required=True, type=float, help="Actual printed tag side length in meters")
    parser.add_argument("--source-kind", default="user_declared_raw_recording")
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    files = {"data/" + name: args.raw / name for name in ["stream_0.h264", "video_packets.csv", "imu.csv"]}
    files.update({"calibration/" + name: args.calibration / name for name in ["cam0.yaml", "cam1.yaml", "extrinsics.yaml"]})
    for path in files.values():
        if not path.is_file():
            parser.error("Missing input: " + str(path))
    parents = Path(__file__).resolve().parents
    root = parents[2] if len(parents) > 2 else None
    if root and (root / "backend/app/main.py").is_file() and root in args.output.resolve().parents:
        parser.error("Save recordings outside the website source checkout")
    meta = {"schema": "mild.x5.sdk.raw.v1", "sensor_route": "insta360_x5", "tag_family": "tagCustom48h12",
            "capture_format": "x5_sdk_unstitched_3840x1920", "clock_units": "sdk_milliseconds",
            "source_kind": args.source_kind, "calibration_provenance": args.calibration_description}
    sensor = {"marker_size_m": args.tag_size, "camera_imu_td_s": args.camera_imu_td,
              "body_output_translation_m": [0., 0., 0.], "output_time_offset_s": 0.}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(args.output, "x", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("metadata.json", json.dumps(meta, indent=2) + "\n")
        archive.writestr("sensor.json", json.dumps(sensor, indent=2) + "\n")
        for name, path in files.items():
            archive.write(path, name)
    print(json.dumps({"archive": str(args.output), "bytes": args.output.stat().st_size,
                      "files": sorted([*files, "metadata.json", "sensor.json"]), "gt_included": False}))


if __name__ == "__main__":
    main()
