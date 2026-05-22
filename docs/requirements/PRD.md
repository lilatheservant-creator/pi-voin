# pi-voin — Voice Dictation for pi-agent Terminal

> Push-to-talk speech-to-text directly in the pi-agent TUI.
> Hold Ctrl+G → speak → release Ctrl → text appears in the editor.

---

## 1. Problem Statement

When working in the pi-agent terminal, typing commands, prompts, or code can be slow or cumbersome (e.g., on mobile devices, during hands-busy workflows, or simply when speaking is faster). There is no built-in voice input in pi. pi-voin fills this gap by adding **push-to-talk voice dictation** as a pi extension, leveraging a local Whisper model on Apple Silicon for fast, private, offline-capable transcription.

## 2. Goals and Non-Goals

### Goals

- **Push-to-talk dictation**: Hold Ctrl+G for ≥300ms to start recording, release Ctrl to stop and inject transcribed text into pi's editor.
- **Real-time volume feedback**: A pixel-style bar meter in a widget below the editor shows mic input level during recording.
- **Local-first STT**: Use the existing `whisper-large-v3-turbo` model via MLX on Apple Silicon — no cloud dependency.
- **Seamless pi integration**: Runs as a pi extension, visible and operable entirely within the pi-agent TUI.
- **Multi-language**: Leverage Whisper's built-in language auto-detection; no language configuration needed.

### Non-Goals

- Voice commands or voice control of pi (e.g., "pi, open file X").
- Continuous always-on listening.
- Cross-platform support (MacOS / Apple Silicon only for prototype).
- Real-time streaming transcription (batch: record full phrase → transcribe → inject).
- GUI or web-based interface.

## 3. User Personas and Use Cases

### Primary User: The Developer at the Terminal

A developer working in the pi-agent TUI who wants to quickly dictate text without touching the keyboard.

| Scenario | Flow |
|----------|------|
| **Quick dictation** | Hold Ctrl+G → speak a sentence → release Ctrl → text appears at cursor in editor |
| **Multi-language input** | Hold Ctrl+G → speak in any language → Whisper auto-detects → text injected |
| **Append to existing text** | Editor already has content → dictated text appends to it |
| **Abort mid-recording** | Recording is active → Escape stops recording, discards audio |

## 4. Functional Requirements

### FR1: Push-to-Talk Trigger

- **Trigger**: Ctrl+G held for ≥300ms starts recording.
- **Abort**: Escape key during recording stops and discards.
- **Release behavior**: Releasing Ctrl stops recording (detected via key repeat heartbeat), triggers transcription, injects result.
- **Fallback**: If heartbeat detection fails, auto-stop after 15s timeout.

### FR2: Audio Capture

- Capture microphone audio to a temporary WAV file using `sox` (`rec` command).
- Simultaneously monitor audio levels for volume meter.
- Clean up temp files after transcription.

### FR3: Speech Recognition

- POST the WAV file to the local Whisper server at `http://127.0.0.1:8002/transcribe`.
- Assume the server is already running (no auto-start in prototype).
- Handle server errors gracefully (retry once, then show error).

### FR4: Volume Indicator Widget

- Display a widget **below the editor** (pi `setWidget` with `placement: "belowEditor"`).
- **Idle state**: Show `voin` label with muted indicator (e.g., `voin  ○`).
- **Recording state**: Show `●` red indicator + bar meter (e.g., `voin  ● [██████░░░░]`).
- **Processing state**: Show spinner/loading indicator.
- Bar meter uses Unicode block characters: `█` (filled), `░` (empty).
- Update rate: ~10Hz during recording.

### FR5: Text Injection

- Appended to whatever is currently in the pi editor.
- If editor has existing text, prepend a space before the new content.
- If transcription returns empty, do nothing.

### FR6: Status Feedback

- Show brief notifications on key events: recording start, injection success, errors.
- Use pi's `ctx.ui.notify()` for transient messages.

## 5. Non-Functional Requirements

| Category | Requirement |
|----------|-------------|
| **Latency** | Time from release → text in editor ≤ 3s for short phrases (<10s audio) on M-series Mac |
| **300ms trigger** | Recording begins within 50ms of the 300ms threshold |
| **Volume meter** | Updates within 100ms of audio level changes |
| **Reliability** | Graceful degradation if Whisper server is down (notification, no crash) |
| **Resource usage** | No persistent background processes when idle |
| **Privacy** | Audio files are local-only, deleted after transcription |

## 6. Constraints and Assumptions

- **Platform**: macOS on Apple Silicon (M1/M2/M3/M4).
- **Dependencies**: `sox` must be installed (`brew install sox`).
- **Whisper server**: Assumed running on `http://127.0.0.1:8001`. Model at `~/.omlx/models/whisper-large-v3-turbo/`.
- **pi extension runtime**: TypeScript extension loaded via `pi --extension`.
- **Terminal**: Supports ANSI escape codes and Unicode block characters.
- **Microphone**: System default mic available and accessible.

## 7. Open Questions

| # | Question | Status |
|---|----------|--------|
| OQ1 | Can we reliably detect key release via `onTerminalInput`? | **Resolved**: Used key repeat heartbeat — \x07 events stop when Ctrl released. 200ms gap = release. |
| OQ2 | Does consuming Ctrl input break `Ctrl+C` and `Ctrl+D`? | **Resolved**: Switched to Ctrl+G (not used by pi or macOS). No conflicts. |
| OQ3 | Should the whisper server be updated to use `~/.omlx/models/` path? | **Resolved**: Server uses `~/.omlx/models/whisper-large-v3-turbo/`. |
| OQ4 | Should we rebuild the whisper backend as a child process? | **Deferred to post-prototype**. Manual start is acceptable. |
| OQ5 | What's the optimal bar meter width? | **Resolved**: Fixed 10 cells. Visually clean, fits all terminal widths. |
