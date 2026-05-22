# pi-voin — Technical Design

> Local push-to-talk voice dictation as a pi-agent extension.

---

## 1. System Overview

```
┌─────────────────────────────────────────────────────────┐
│                    pi-agent TUI                          │
│                                                         │
│   ┌─────────────────────────────────────────────────┐   │
│   │  Editor (user types / dictated text appears)     │   │
│   └─────────────────────────────────────────────────┘   │
│   ┌─────────────────────────────────────────────────┐   │
│   │  Widget: voin  ● [██████░░░░]  (below editor)   │   │
│   └─────────────────────────────────────────────────┘   │
│   ┌─────────────────────────────────────────────────┐   │
│   │  Footer: model info + git branch                 │   │
│   └─────────────────────────────────────────────────┘   │
│                                                         │
│   ┌─────────────────────────────────────────────────┐   │
│   │  pi-voin Extension (background)                  │   │
│   │  ├─ Key Listener (Ctrl+G via onTerminalInput)    │   │
│   │  ├─ Audio Recorder (child_process → sox)         │   │
│   │  ├─ Level Monitor (reads sox level output)       │   │
│   │  └─ Widget Renderer (setWidget)                  │   │
│   └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                           │
              POST /transcribe (WAV)
                           ▼
┌─────────────────────────────────────────────────────────┐
│  Whisper Server (port 8002)                             │
│  ├─ FastAPI + uvicorn                                   │
│  └─ mlx_whisper.transcribe() → Metal GPU               │
│     Model: ~/.omlx/models/whisper-large-v3-turbo/      │
│     Note: 8001 occupied by Irodori-TTS                  │
└─────────────────────────────────────────────────────────┘
```

## 2. pi Integration Points

| pi API | Usage |
|--------|-------|
| `pi.on("session_start")` | Initialize extension: check sox, register widget, set up key listener |
| `pi.on("session_before_switch")` | Clean up: stop recording, cancel transcription, destroy state machine |
| `ctx.ui.onTerminalInput()` | Listen for Ctrl+G (\x07) events — press and heartbeat |
| `ctx.ui.setWidget("voin", renderer, { placement: "belowEditor" })` | Volume meter + status widget |
| `ctx.ui.getEditorText()` | Get current editor content before injection |
| `ctx.ui.setEditorText(text)` | Set editor content with appended transcription |
| `ctx.ui.notify(msg, type)` | Transient notifications (start, success, error) |
| `ctx.ui.theme` | Theme colors for widget rendering |

## 3. Component Design

### 3.1 State Machine

The extension operates in one of four states:

```
              300ms elapsed
  IDLE ──────────────────► RECORDING
  ↑                              │
  │        escape / timeout      │ release Ctrl
  │                              ▼
  └──────────────────◄── PROCESSING
       discard               inject text
```

| State | Widget Display | Behavior |
|-------|---------------|----------|
| `IDLE` | `voin  ○` (muted) | Listening for Ctrl press |
| `PENDING` | `voin  ◌` (pulsing) | Ctrl held <300ms, timer running |
| `RECORDING` | `voin  ● [████░░]` (active) | Capturing audio, updating volume meter |
| `PROCESSING` | `voin  ⠋` (spinner) | Transcribing, blocking input |

### 3.2 Key Detection

**Trigger**: Ctrl+G (chosen over bare Ctrl because `onTerminalInput` doesn't fire for standalone modifiers, and over CapsLock because it's not a valid `KeyId`).

**Press detection** via `onTerminalInput`:
- Ctrl+G sends `\x07` (BEL, ASCII 7) in legacy terminal mode.
- `matchesKey(data, "ctrl+g")` handles Kitty protocol mode.
- First press starts a 300ms pending timer. If 300ms elapses → RECORDING.

**Release detection** via key repeat heartbeat:
- While Ctrl+G is held, the terminal sends `\x07` repeatedly (~20ms interval, macOS key repeat rate).
- Each `\x07` resets a 200ms heartbeat timer.
- When the user releases Ctrl, `\x07` events stop. After 200ms of no events → release detected → stop recording.
- The overlay-based `wantsKeyRelease` approach was abandoned because it consumed ALL input, blocking editor typing.

**Fallback**: 15s hard timeout if heartbeat detection fails.

**No conflicts**: Ctrl+G is not used by macOS (Ctrl+Space is the language switch) and not bound to any pi keybinding.

### 3.3 Audio Capture

Uses `sox` (Sound eXchange), available via `brew install sox`.

**Recording command**:
```bash
sox -d -r 16000 -c 1 -b 16 /tmp/voin-XXXXXX.wav
```

- `-d`: Default input device (system mic)
- `-r 16000`: Whisper expects 16kHz mono
- `-c 1`: Mono channel
- `-b 16`: 16-bit samples

**Level monitoring** (parallel process):
```bash
sox -d -r 16000 -c 1 -b 16 -n stat 2>&1
```

Or more practically, read the WAV file's RMS periodically:
```typescript
// Every 100ms, read the temp WAV file, compute RMS of last chunk
// Map RMS to 0-10 scale for the bar meter
```

**Implementation**:
- `child_process.spawn('sox', args)` to start recording.
- `fs.readFileSync` on the temp WAV at 10Hz to sample audio levels.
- On stop: kill sox process, send WAV to whisper server, delete temp file.

### 3.4 Speech Recognition Backend

**Existing server.py** (`~/whisper/server.py`):
- FastAPI server on `http://127.0.0.1:8002` (8001 occupied by Irodori-TTS)
- `POST /transcribe` accepts WAV file upload
- Returns `{ text, language, duration }`
- Model path updated to `~/.omlx/models/whisper-large-v3-turbo`

**Decision**: Model path updated. Server runs on port 8002. The extension assumes the server is already running.

**Alternative (future)**: Spawn the server as a child process from the extension itself. This eliminates the "must start server manually" requirement. Deferred to post-prototype.

### 3.5 TUI Widget

Uses pi's `setWidget` API with a dynamic renderer function:

```typescript
ctx.ui.setWidget("voin", (tui, theme) => ({
  render: () => {
    switch (state) {
      case "IDLE":
        return [theme.fg("dim", "voin  ○")];
      case "PENDING":
        return [theme.fg("muted", "voin  ◌")];
      case "RECORDING":
        return [
          theme.fg("error", "voin  ● ") + volumeBar(level),
        ];
      case "PROCESSING":
        return [theme.fg("accent", `voin  ${spinnerFrame()}`)];
    }
  },
  invalidate: () => {},
}), { placement: "belowEditor" });
```

**Volume bar** (10 cells):
```
[████████░░]  → 80%
[███░░░░░░░]  → 30%
```

Uses Unicode full block `█` and light shade `░`. Wrapped in `[` `]` brackets.

### 3.6 Text Injection

```typescript
const existing = ctx.ui.getEditorText();
const injected = existing
  ? existing + (existing.endsWith("\n") ? "" : " ") + transcribedText
  : transcribedText;
ctx.ui.setEditorText(injected);
```

## 4. Data Flow

```
1. User presses and holds Ctrl+G
2. onTerminalInput receives \x07 (BEL) → triggerPressed() → state = PENDING
3. 300ms timer starts. If 300ms elapses → state = RECORDING
   a. Generate temp file path: /tmp/voin-{pid}-{timestamp}.wav
   b. Spawn sox: child_process.spawn('sox', ['-d', '-r','16000', '-c','1', '-b','16', tempPath])
   c. Start level monitoring interval (100ms)
   d. Update widget: red dot + volume bar
4. User speaks (volume bar animates). Terminal sends \x07 repeats (~20ms interval).
   Each repeat resets the 200ms heartbeat timer.
5. User releases Ctrl → \x07 repeats stop → 200ms heartbeat gap → state = PROCESSING
   a. Kill sox process
   b. Update widget: spinner
   c. POST WAV to http://127.0.0.1:8002/transcribe
   d. On response: append text to editor, notify success
   e. Clean up temp file
   f. state = IDLE
6. If Escape pressed during RECORDING → kill sox, delete temp, state = IDLE
7. If Escape pressed during PROCESSING → cancel HTTP request, discard result
8. If 15s timeout during RECORDING → same as release (auto-stop)
```

## 5. Extension Structure

```
pi-voin/                          ← Project root
├── docs/
│   ├── requirements/PRD.md
│   ├── design/ARCHITECTURE.md
│   └── tasks/WORKPLAN.md
│   └── orchestra.md            ← Multi-agent cooperation protocol
├── extension/
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts              ← Extension entry (session_start hook)
│   │   ├── state.ts              ← State machine (IDLE/PENDING/RECORDING/PROCESSING)
│   │   ├── key-listener.ts       ← Ctrl detection via onTerminalInput
│   │   ├── audio-recorder.ts     ← sox child process management
│   │   ├── level-monitor.ts      ← WAV RMS sampling → volume level
│   │   ├── widget.ts             ← TUI widget renderer
│   │   └── transcriber.ts        ← HTTP POST to whisper server
│   └── package.json
└── whisper-server/
    └── server.ts                 ← Updated server.py → TypeScript/FastAPI equivalent
```

### Why TypeScript for the extension?

pi extensions are TypeScript modules. The extension code runs inside pi's Node.js process. `tsx` handles the TypeScript execution.

### Whisper server: keep Python or port to TS?

**Keep Python** for prototype. The `mlx_whisper` library is Python-only. Porting to TS would require ONNX or other runtime, adding complexity. The server is a simple FastAPI app — keeping it as Python with an updated model path is the fastest path to prototype.

## 6. Error Handling and Edge Cases

| Scenario | Behavior |
|----------|----------|
| Whisper server not running | `notify("voin: whisper server unavailable", "error")`, stay IDLE |
| Server returns 500 | Retry once, then `notify("voin: transcription failed", "error")` |
| No microphone found | `notify("voin: no microphone available", "error")` on first recording attempt |
| `sox` not installed | `notify("voin: sox not found. Run: brew install sox", "error")` |
| Empty transcription | Silently discard (no injection, no notification) |
| Very long recording (>30s) | Auto-stop, transcribe, inject |
| Escape during RECORDING | Kill sox, discard audio, no transcription |
| Escape during PROCESSING | Cancel HTTP request, discard result |
| Ctrl+C during RECORDING | Passthrough to pi (abort agent), also stop recording |
| Terminal too narrow | Truncate bar meter to fit, minimum 5 cells |

## 7. Open Questions

| # | Question | Decision |
|---|----------|----------|
| OQ1 | Can `wantsKeyRelease` reliably detect Ctrl release in all terminals? | **Resolved**: Abandoned `wantsKeyRelease` (blocks editor input). Using key repeat heartbeat instead. |
| OQ2 | Should the extension auto-start the whisper server? | **No for prototype** — Manual start is acceptable |
| OQ3 | Is reading the WAV file at 100ms intervals fast enough for smooth volume meter? | **Yes** — 10fps is visually smooth |
| OQ4 | Should we use `stat` mode of sox instead of reading the WAV file for levels? | **No** — `stat` only gives final stats. WAV RMS sampling works well. |
| OQ5 | What if the user is already holding Ctrl+G when the extension loads? | **Edge case** — Ignore, wait for a fresh press |
