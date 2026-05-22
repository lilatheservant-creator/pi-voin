# pi-voin

Push-to-talk voice dictation for [pi-agent](https://github.com/earendil-works/pi). Hold a key, speak, release — transcribed text appears in the editor. Local-first, private, no cloud dependency.

```
┌──────────────────────────────────────────────┐
│  Editor: ...I think the solution is          │
│                                               │
│  ───────────────────────────────────────────  │
│  voin  ● [██████░░░░]                         │  ← volume meter
│  ───────────────────────────────────────────  │
│  0.0%/128k (auto)   Jundot-Qwen3.6-27B-oQ4   │
└──────────────────────────────────────────────┘
```

## Features

- **Push-to-talk**: Hold `Ctrl+G` for 300ms to start recording, release to stop
- **Local STT**: Whisper `large-v3-turbo` via MLX on Apple Silicon — runs entirely offline
- **Real-time volume meter**: 10-cell bar shows mic input level during recording
- **Smart text injection**: Handles spacing, newlines, and trailing whitespace
- **Multi-language**: Whisper auto-detects spoken language
- **Escape to cancel**: Press `Esc` during recording to discard

## Prerequisites

- **macOS** on Apple Silicon (M1/M2/M3/M4)
- **sox**: `brew install sox`
- **Whisper server** running on `http://127.0.0.1:8002`
- **pi-agent** installed and working

### Whisper Server

You need a local Whisper server running. The project includes one in `whisper-server/`.

```bash
cd whisper-server
python3 -m venv .
source bin/activate
pip install -r requirements.txt
python server.py
```

Server starts on `http://127.0.0.1:8002`. First request takes ~30s (model load). See [whisper-server/README.md](whisper-server/README.md) for full setup.

If you already have a server at `~/whisper/server.py`, leave it running — voin uses port 8002.

## Installation

### Option 1: Install globally (recommended)

```bash
pi install /path/to/pi-voin/extension
```

After this, voin loads automatically every time you run `pi`. No flags needed.

### Option 2: Run for development

```bash
cd pi-voin/extension
npm install          # first time only
npm run dev          # runs pi with hot-reload
```

### Option 3: One-off

```bash
pi --extension /path/to/pi-voin/extension/src/index.ts
```

## Usage

1. **Start pi** with the voin extension (`npm run dev` or `pi --extension`)
2. You'll see `voin  ○` in the widget below the editor — ready to dictate
3. **Hold `Ctrl+G`** for ~300ms — the indicator turns to `●` and the volume bar appears
4. **Speak** your text (volume bar responds to your voice)
5. **Release `Ctrl`** — recording stops, transcription runs, text appears in the editor

### States

| State | Widget | Meaning |
|-------|--------|---------|
| `IDLE` | `voin  ○` | Ready, waiting for trigger |
| `PENDING` | `voin  ◌` | Key held <300ms, timer running |
| `RECORDING` | `voin  ● [██████░░░░]` | Capturing audio |
| `PROCESSING` | `voin  ⠋` | Transcribing via Whisper |

### Key Bindings

| Key | Action |
|-----|--------|
| `Ctrl+G` (hold) | Start recording after 300ms |
| Release `Ctrl` | Stop recording, transcribe |
| `Esc` | Cancel recording (during RECORDING/PROCESSING) |

## Troubleshooting

### "sox is not installed"

```bash
brew install sox
```

### No microphone permission prompt

Go to **System Settings → Privacy & Security → Microphone** and grant access to your terminal app (Ghostty, iTerm2, etc.).

### "Whisper server returned 502/503"

The Whisper server isn't running or crashed. Start it:

```bash
cd ~/whisper && python3 server.py
```

### "Transcription failed" / connection refused

Verify the server is on port 8002:

```bash
curl http://127.0.0.1:8002/transcribe
```

### Recording doesn't start when holding Ctrl+G

- Make sure you're **holding** Ctrl+G (not just pressing once)
- Wait for the indicator to change from `◌` to `●`
- If using tmux, exit it — tmux intercepts key events

### Text doesn't appear in editor

- Check that the transcription completes (widget shows spinner, then returns to `○`)
- If the recording was <0.5s, it's silently skipped
- Check the notification bar for error messages

## Architecture

```
pi-agent TUI
├── Editor (dictated text appears here)
├── Widget (voin volume meter + status)
└── pi-voin Extension
    ├── State Machine (IDLE → PENDING → RECORDING → PROCESSING)
    ├── Key Listener (Ctrl+G via onTerminalInput)
    ├── Audio Recorder (sox child process)
    ├── Level Monitor (WAV RMS sampling at 10Hz)
    └── Transcriber (HTTP POST → Whisper server)

Whisper Server (port 8002)
├── FastAPI + uvicorn
└── mlx_whisper.transcribe() → Metal GPU
```

See [docs/design/ARCHITECTURE.md](docs/design/ARCHITECTURE.md) for full technical design.

## Project Structure

```
pi-voin/
├── README.md                    ← This file
├── docs/
│   ├── requirements/PRD.md      ← Product requirements
│   ├── design/ARCHITECTURE.md   ← Technical design
│   └── tasks/WORKPLAN.md        ← Implementation tasks
├── extension/
│   ├── package.json
│   └── src/
│       ├── index.ts             ← Extension entry point
│       ├── state.ts             ← State machine
│       ├── key-listener.ts      ← Ctrl+G trigger detection
│       ├── audio-recorder.ts    ← sox process management
│       ├── level-monitor.ts     ← Volume meter (RMS sampling)
│       ├── widget.ts            ← TUI widget renderer
│       └── transcriber.ts       ← Whisper HTTP client
└── whisper-server/
    ├── README.md                ← Server setup guide
    ├── requirements.txt         ← Python dependencies
    └── server.py                ← FastAPI + MLX Whisper
```

## Development

```bash
cd extension

# Type-check
npm run typecheck

# Run with pi (hot-reload on file changes)
npm run dev
```

## Limitations

- **macOS Apple Silicon only** — relies on MLX (Metal) for Whisper
- **Whisper server must be started manually** — extension doesn't auto-start it
- **No tmux support** — tmux intercepts terminal key events
- **Single speaker** — no speaker diarization
- **Batch transcription** — records full phrase, then transcribes (no streaming)

## License

MIT
