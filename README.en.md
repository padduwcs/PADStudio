<p align="center"><img src="ui/brand/padstudio-emblem-transparent.png" alt="PADStudio" width="220" /></p>

<h1 align="center">PADStudio</h1>
<p align="center"><strong>Precise Animated Demonstration Studio</strong><br />A video studio that runs on your machine, led by an AI Agent.</p>

<p align="center"><a href="README.md">Tiếng Việt</a> · <a href="CONTRIBUTING.md#english-summary">Contributing</a> · <a href="CHANGELOG.md">Changelog</a></p>

<p align="center"><img src="docs/images/library-dark.png" alt="The PADStudio project library: every card is a video made with PADStudio" width="860" /></p>

> **Language note.** PADStudio's interface and in-depth guides are in Vietnamese, and its narration, transcription and quality checks are
> tuned for Vietnamese. This page is a short English guide to what it is and how to get it running.

## Overview

You describe the video you want to an AI Agent (for example [Claude Code](https://claude.com/claude-code)). The Agent writes the script,
builds the animation, makes the voice-over, then assembles and exports the video. PADStudio is the foundation underneath: it stores
projects, runs the tools and records every input, result and piece of feedback, so a project can always be reopened and continued, even
in a new Agent session.

- **You decide.** There is no fixed pipeline. You watch, give feedback in the conversation, and accept only when you are happy.
- **Traceable.** Every file records its source, rights, the tool that made it and a checksum. The accepted video is delivered byte for byte.
- **Local.** Data stays in the project folder. Paid services (such as ElevenLabs) are always asked about first and can be capped.

## Quick start

**Requirements:** Windows 10/11, [Node.js](https://nodejs.org) 20+, [FFmpeg](https://ffmpeg.org) with `ffprobe` on `PATH`, and an Agent
that can run commands in the project folder. PADStudio has no npm dependencies, so there is no `npm install`.

**1. Clone and check your machine**

```powershell
git clone https://github.com/padduwcs/PADStudio.git
cd PADStudio
npm run padstudio:doctor
```

**2. Open the observer page** at <http://127.0.0.1:7603>

```powershell
npm run observer:ensure
```

**3. Start your Agent in this folder** (Claude Code: `claude`). It reads [`AGENTS.md`](AGENTS.md) by itself and knows how to operate
PADStudio. Then ask for what you want:

> Make a 90-second vertical video explaining why the sky is blue, narrated in Vietnamese, for middle-school students.

**4. Watch, give feedback, accept.** Each build appears on the observer page. To change one spot, pause there, click
**Sao chép mốc phản hồi** (*copy feedback anchor*) and paste it into the chat with what you want changed. When you are happy, say
"accept" (in Vietnamese: "chốt") and download the accepted video.

<p align="center"><img src="docs/images/video-dark.png" alt="Observer page: play the video, download the accepted version and jump to each segment" width="760" /></p>

## What it can make

| Kind of video | Notes |
| --- | --- |
| **Animated explainers** (main strength) | Algorithms, maths, science, technology; 1–3 minutes; vertical 9:16, landscape 16:9 or square; narration and subtitles |
| Edits of existing footage | Cut, join, summarize, subtitles, music; automatic transcription and scene detection |
| Video from images and graphics | Gentle zoom and pan, title cards, charts, step diagrams |
| Short social videos, product demos | For social media or product introductions |

- **Animation:** Manim (formulas, geometry), Remotion (kinetic text, UI, charts), HyperFrames (frame-exact HTML/CSS).
- **Built-in styles (optional):** educational code, talking head, short form, product demo, minimal editorial.
- **Narration:** Piper (free, local) or ElevenLabs (paid; voice and model are chosen on the observer page).

## Optional tools

FFmpeg alone is enough to edit, join, subtitle and export. Everything else is optional; install it following
[`docs/CAI-DAT-RUNTIME.md`](docs/CAI-DAT-RUNTIME.md) (Vietnamese, but every command is copy-and-paste; versions are pinned and downloads
are checksum-verified):

| You want | You need |
| --- | --- |
| Remotion / HyperFrames animation | Pinned npm packages; Chrome Headless Shell for Remotion |
| Manim animation | Python 3.12 + `manim` |
| Free local narration | Piper + a Vietnamese voice model |
| Transcription and scene detection of footage | Python 3.12 + Whisper models (~5 GB) |
| ElevenLabs narration | Just an API key, pasted on the **Tools** page |

PADStudio never installs anything by itself. The **Tools** page (*Công cụ*, top of the observer page) shows what is ready and how to
enable what is missing.

<p align="center"><img src="docs/images/tools-overview-dark.png" alt="Tools page: the status of each tool on this machine" width="760" /></p>

## How it works

```mermaid
flowchart LR
    U([You]) <-->|chat, feedback, accept| A[Agent<br/>Claude Code or similar]
    A -->|PADStudio command line| P[PADStudio<br/>project store + executor]
    P --> T[FFmpeg · Manim · Remotion<br/>HyperFrames · narration]
    P --- S[(.padstudio/projects<br/>inputs, results, decisions)]
    S --> W[Observer page<br/>127.0.0.1:7603, read-only for projects]
    W -->|you watch and copy feedback anchors| U
```

- **The Agent** is the only channel for commands: it understands the request and chooses the work and the tools.
- **PADStudio** stores projects, runs tools and keeps the trail. It has no chat of its own and makes no content decisions.
- **The observer page** is for watching videos, downloading the accepted one and editing machine settings (API keys, voice). It never
  writes to a project.

## Current limits

PADStudio is at **version 0.1** ([pre-release](https://github.com/padduwcs/PADStudio/releases/tag/v0.1.0)); `main` is always the newest.

- **Tested on Windows only.** macOS and Linux have not been tried.
- **Tuned for Vietnamese.** Narration, transcription and quality checks are tuned for it.
- **Automated checks catch technical faults only.** You still need to watch and listen for creative quality.
- **The ElevenLabs voice picker has only been tested against a simulated service.** If it behaves differently with a real account, please
  open an issue.
- **Animation code written by the Agent runs directly on your machine, without a sandbox.** See [`SECURITY.md`](SECURITY.md) (Vietnamese;
  in short: the observer listens on localhost only, API keys live in a git-ignored `padstudio.local.json`, and generated code is not isolated).

## Contributing

Contributions are welcome. Read [`CONTRIBUTING.md`](CONTRIBUTING.md) (it has an English summary at the end) and
[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) first.

```powershell
npm run check   # syntax, unused imports, links and paths in the docs (a few seconds)
npm test        # the full test suite (about a minute)
```

Report vulnerabilities privately, see [`SECURITY.md`](SECURITY.md).

## License

Source code is under the [MIT license](LICENSE), © 2026 Anh-Duc Phan. The Manrope font in `ui/fonts/` is under the SIL Open Font License
([`ui/fonts/OFL.txt`](ui/fonts/OFL.txt)). The logo and brand assets in [`ui/brand/`](ui/brand/README.md) belong to the project author; ask
before using them elsewhere. External tools (FFmpeg, Manim, Remotion, HyperFrames, Piper, Whisper, ElevenLabs) have their own licenses;
you install them yourself and are responsible for complying with them, especially when distributing videos.
