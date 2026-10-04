#!/usr/bin/env python3
"""
Generate the ``public/`` directory that Vercel serves from its CDN.

Vercel's Flask preset serves every file in ``public/**`` as a static asset and
routes everything else to the Flask app in ``app.py``. The frontend in
``frontend/`` is therefore copied into ``public/`` at build time:

    python build_vercel.py            # frontend/ -> public/
    python build_vercel.py --check    # fail (exit 1) if public/ is out of date

``frontend/`` remains the single source of truth – edit it there and preview
with the Flask dev server or VS Code Live Server. ``public/`` is generated and
must never be edited by hand.

The local upload folder (``frontend/assets/uploads``) is deliberately *not*
copied: in any hosted deployment user images live in the S3-compatible bucket
(``UPLOAD_STORAGE=s3``), and on a VPS they are served straight from
``frontend/assets/uploads``.
"""

import argparse
import filecmp
import json
import os
import shutil
from datetime import datetime, timezone

PROJECT_ROOT = os.path.abspath(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_SOURCE = os.path.join(PROJECT_ROOT, "frontend")
DEFAULT_OUTPUT = os.path.join(PROJECT_ROOT, "public")

#: Written into the output directory so a later run recognises it as generated
#: (and may therefore replace it without asking).
MARKER_NAME = ".vercel-build.json"

#: Files that must exist in the source for the site to work.
REQUIRED_FILES = (
    "index.html",
    "css/style.css",
    "js/api.js",
    "js/ui.js",
    "pages/home.html",
)

#: Paths that must never be published to the CDN.
EXCLUDED_DIRS = (
    "assets/uploads",          # user uploads live in object storage
)


class BuildError(RuntimeError):
    """Raised when a valid ``public/`` directory cannot be produced."""


def _normalise(rel_path: str) -> str:
    """Return a portable forward-slash relative path (``""`` for the root)."""
    rel_path = os.path.normpath(rel_path)
    if rel_path in (".", ""):
        return ""
    return rel_path.replace(os.sep, "/")


def _is_published(rel_path: str) -> bool:
    """True when ``rel_path`` belongs in the published site."""
    rel = _normalise(rel_path)
    if not rel:
        return False
    if rel.rsplit("/", 1)[-1].startswith("."):        # .gitkeep, .DS_Store, …
        return False
    for excluded in EXCLUDED_DIRS:
        if rel == excluded or rel.startswith(excluded + "/"):
            return False
    return True


def source_files(source: str) -> list:
    """Sorted ``(absolute_path, relative_path)`` pairs to publish."""
    collected = []
    for root, dirnames, filenames in os.walk(source):
        rel_root = _normalise(os.path.relpath(root, source))
        dirnames[:] = sorted(
            name
            for name in dirnames
            if _is_published(f"{rel_root}/{name}" if rel_root else name)
        )
        for filename in sorted(filenames):
            rel = f"{rel_root}/{filename}" if rel_root else filename
            if _is_published(rel):
                collected.append((os.path.join(root, filename), rel))
    return sorted(collected, key=lambda pair: pair[1])


def _validate_source(source: str) -> None:
    if not os.path.isdir(source):
        raise BuildError(
            f"Frontend source directory not found: {source}\n"
            "Run this script from the repository root."
        )
    missing = [
        rel for rel in REQUIRED_FILES if not os.path.isfile(os.path.join(source, rel))
    ]
    if missing:
        raise BuildError("Frontend source is incomplete – missing: " + ", ".join(missing))


def _prepare_output(output: str, force: bool) -> None:
    """Make sure ``output`` is an empty directory we are allowed to write to."""
    if not os.path.exists(output):
        os.makedirs(output, exist_ok=True)
        return
    if not os.path.isdir(output):
        raise BuildError(f"Output path exists and is not a directory: {output}")

    contents = os.listdir(output)
    if not contents:
        return
    if MARKER_NAME not in contents and not force:
        raise BuildError(
            f"Refusing to overwrite {output}: it is not empty and was not generated "
            f"by this script (no {MARKER_NAME} marker). Use --force if that directory "
            "is disposable."
        )
    for name in contents:
        path = os.path.join(output, name)
        if os.path.isdir(path):
            shutil.rmtree(path)
        else:
            os.remove(path)


def build(source: str = DEFAULT_SOURCE, output: str = DEFAULT_OUTPUT,
          force: bool = False) -> dict:
    """Copy the frontend into ``output`` and return a summary dictionary."""
    source = os.path.abspath(source)
    output = os.path.abspath(output)
    _validate_source(source)

    files = source_files(source)
    total_bytes = sum(os.path.getsize(path) for path, _ in files)

    _prepare_output(output, force)
    os.makedirs(output, exist_ok=True)
    for path, rel in files:
        destination = os.path.join(output, *rel.split("/"))
        os.makedirs(os.path.dirname(destination), exist_ok=True)
        shutil.copy2(path, destination)

    manifest = {
        "generated_by": "build_vercel.py",
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": os.path.relpath(source, PROJECT_ROOT),
        "output": os.path.relpath(output, PROJECT_ROOT),
        "files": [rel for _, rel in files],
    }
    with open(os.path.join(output, MARKER_NAME), "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, indent=2)
        handle.write("\n")

    return {
        "source": source,
        "output": output,
        "files": len(files),
        "bytes": total_bytes,
        "excluded": list(EXCLUDED_DIRS),
    }


def check(source: str = DEFAULT_SOURCE, output: str = DEFAULT_OUTPUT) -> list:
    """Return the differences between ``output`` and a fresh build."""
    source = os.path.abspath(source)
    output = os.path.abspath(output)
    _validate_source(source)
    if not os.path.isdir(output):
        return [f"{os.path.relpath(output, PROJECT_ROOT)} does not exist yet"]

    expected = {rel: path for path, rel in source_files(source)}
    actual = {rel: path for path, rel in source_files(output)}

    problems = [f"missing: {rel}" for rel in sorted(set(expected) - set(actual))]
    problems += [f"unexpected: {rel}" for rel in sorted(set(actual) - set(expected))]
    problems += [
        f"out of date: {rel}"
        for rel in sorted(set(expected) & set(actual))
        if not filecmp.cmp(expected[rel], actual[rel], shallow=False)
    ]
    return problems


def _print_summary(summary: dict) -> None:
    print(
        "Vercel static build ready: "
        f"{summary['files']} files, {summary['bytes'] / 1024:.1f} KB -> "
        f"{os.path.relpath(summary['output'], PROJECT_ROOT)}/"
    )
    print("public/ is served from the CDN; Flask answers /api/* and acts as fallback.")
    print("Excluded: " + ", ".join(summary["excluded"]))


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        description="Generate the public/ directory Vercel serves as static assets."
    )
    parser.add_argument("--source", default=DEFAULT_SOURCE,
                        help="frontend source directory (default: frontend/)")
    parser.add_argument("--output", default=DEFAULT_OUTPUT,
                        help="directory to generate (default: public/)")
    parser.add_argument("--check", action="store_true",
                        help="report differences instead of writing files")
    parser.add_argument("--force", action="store_true",
                        help="replace a non-empty output directory not created by this script")
    args = parser.parse_args(argv)

    try:
        if args.check:
            problems = check(args.source, args.output)
            if problems:
                print("public/ is out of date:")
                for problem in problems:
                    print(f"  - {problem}")
                return 1
            print("public/ is up to date with frontend/.")
            return 0
        summary = build(args.source, args.output, force=args.force)
    except BuildError as exc:
        print(f"Build failed: {exc}")
        return 1

    _print_summary(summary)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
