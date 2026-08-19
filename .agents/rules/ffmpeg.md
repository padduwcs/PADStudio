---
description: Avoid false positives when checking for FFmpeg and FFprobe in PAD Studio.
---

# FFmpeg Guidelines for PAD Studio

1. FFmpeg and FFprobe are **ALREADY INSTALLED** on the user's machine and available globally in the system `PATH`.
2. Do **NOT** assume they are missing just because the `FFMPEG_PATH` or `PAD_FFMPEG_PATH` variables are empty in `.env` or `.env.example`. The application uses `where.exe ffmpeg` internally to resolve the path dynamically, and this mechanism works correctly.
3. If a task involves verifying dependencies, running `npm run doctor` is the only source of truth. If it says `FFmpeg: available`, then no further configuration is required.
4. Do **NOT** prompt the user to install FFmpeg, set environment variables, or update `.env` to point to an FFmpeg binary.
