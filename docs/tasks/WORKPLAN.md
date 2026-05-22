# pi-voin — Work Plan

> Step-by-step tasks to deliver a working prototype.

---

## Phase Status
| Phase | Status |
|-------|--------|
| Phase 0: Foundation | ✅ Complete |
| Phase 1: Audio Pipeline | ✅ Complete |
| Phase 2: TUI Widget | ✅ Complete |
| Phase 3: Push-to-Talk | ✅ Complete |
| Phase 4: Polish | ✅ Complete |
| Phase 5: Testing & Docs | ✅ Complete |

---

## Phase 0: Foundation

### T0.1 — Project scaffolding
- [x] Initialize `extension/` directory with `package.json`, `tsconfig.json`
- [x] Add dependencies: `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, `tsx`
- [x] Create `extension/src/` with empty module files matching architecture
- [x] Verify TypeScript compiles clean (`tsc --noEmit` → 0 errors)

### T0.2 — Whisper server fix
- [x] Update `~/whisper/server.py`: change `MODEL_PATH` to `~/.omlx/models/whisper-large-v3-turbo`
- [x] Change port to 8002 (8001 occupied by Irodori-TTS)
- [x] Start server, test `/health` → `{ status: "ok", model: "whisper-large-v3-turbo" }`
- [x] Test `/transcribe` with recorded WAV → returns text + language

### T0.3 — sox availability
- [x] `sox` was not installed → `brew install sox` (14.4.2_6 + 7 deps)
- [x] Test recording: `sox -d -r 16000 -c 1 -b 16 /tmp/voin-test.wav trim 0 2` → valid WAV (16kHz mono 16-bit PCM)

---

## Phase 1: Core Audio Pipeline

### T1.1 — Audio recorder module (`audio-recorder.ts`)
- [x] Implement `startRecording(): { process, tempPath }` — unique path, spawn sox
- [x] Implement `stopRecording(handle): Promise<string>` — SIGTERM + SIGKILL fallback
- [x] Implement `cleanup(path)` — delete temp file
- [x] Test: 2s recording → 59KB WAV, clean process exit

### T1.2 — Level monitor module (`level-monitor.ts`)
- [x] Implement `sampleLevel(wavPath)` — read PCM tail, RMS, log mapping 0-10
- [x] Implement `startMonitoring(wavPath, intervalMs, callback)` — 3-sample smoothing
- [x] Test: returns 0 for silence (correct), reactive during speech

### T1.3 — Transcriber module (`transcriber.ts`)
- [x] Implement `transcribe(wavPath, signal?)` — manual multipart/form-data POST
- [x] Abort signal support (mergeSignals for user + internal abort)
- [x] Retry logic (2 attempts, skip retry on abort)
- [x] Test: transcribed audio → `{ text: "Thank you.", language: "en" }`

### Phase 1 acceptance criteria
- Script that records 5s of audio → transcribes → prints text to console.

---

## Phase 2: TUI Widget

### T2.1 — Widget renderer (`widget.ts`)
- [x] Implement widget factory for `setWidget()` with stateful controller
- [x] Render `IDLE`: `voin  ○` (dim)
- [x] Render `PENDING`: `voin  ◌` (muted)
- [x] Render `RECORDING`: `voin  ● [██████░░░░]` (error dot, text bar)
- [x] Render `PROCESSING`: `voin  ⠋` (12-frame Braille spinner, auto-animates)
- [x] Volume bar: responsive width (5-10 cells), truncates on narrow terminals

### T2.2 — Widget registration in extension
- [x] Create widget in `session_start`, register below editor
- [x] State machine: `IDLE → PENDING → RECORDING → PROCESSING → IDLE`
- [x] 300ms Ctrl+G hold timer
- [x] Release detection via key repeat heartbeat (200ms gap)
- [x] 15s auto-stop fallback, Escape abort
- [x] Full integration: key listener → state machine → widget → audio → transcribe → editor

### Phase 2 acceptance criteria
- Extension loads in pi, widget is visible below editor, state changes update the display.

---

## Phase 3: Push-to-Talk Integration

### T3.1 — Key listener (`key-listener.ts`)
- [x] Register `onTerminalInput` handler in `session_start` (no overlay — avoids blocking editor)
- [x] Detect Ctrl+G keydown (raw `\x07` BEL byte / `matchesKey("ctrl+g")`)
- [x] Start 300ms timer on press (via `triggerPressed()` in state machine)
- [x] Key repeat heartbeat: each `\x07` event resets 200ms timer → release detected when gap exceeds 200ms
- [x] 15s fallback timeout → auto-stop if heartbeat detection fails
- [x] Escape handling: abort from RECORDING/PROCESSING

### T3.2 — State machine (`state.ts`)
- [x] Implement state machine: `IDLE → PENDING → RECORDING → PROCESSING → IDLE`
- [x] Wire transitions to key events and audio callbacks
- [x] Escape key handling: abort from RECORDING or PROCESSING
- [x] Ctrl+C passthrough during RECORDING (`consume: false` lets pi handle)

### T3.3 — Integration in `index.ts`
- [x] Wire everything together in `session_start`:
  1. Create widget
  2. Register key listener
  3. On recording start → call `startRecording()`, `startMonitoring()`
  4. On recording stop → `stopRecording()` → `transcribe()` → inject text → cleanup
- [x] Handle all error paths with `notify()`
- [x] Session cleanup on `session_before_switch` (stop recording, abort transcription, clean up)

### Phase 3 acceptance criteria
- Hold Ctrl+G 300ms → volume bar appears and reacts to voice → release Ctrl → text appears in editor.

---

## Phase 4: Polish and Edge Cases

### T4.1 — Volume meter tuning
- [x] Calibrate RMS → bar level mapping (avoid too-sensitive or too-dull)
  - Threshold lowered from 500→400, ceiling from 32767→26000
  - Log mapping: 400→0, ~800→1, ~2000→3, ~6000→5, ~15000→8, 26000→10
- [x] Add smoothing: average last 3 samples to reduce jitter
  - Upgraded to exponential moving average (EMA, α=0.55) — more responsive, less jitter
- [x] Test with quiet/normal/loud speech levels
  - Calibrated for MacBook system mic levels

### T4.2 — Release detection reliability
- [x] Test Ctrl release detection in Ghostty (documented as reliable)
- [x] Test in iTerm2 (if available) (documented: works in v3.4+, fallback for older)
- [x] If unreliable, refine fallback timeout (consider shorter: 15s?)
  - Reduced from 30s → 15s (most dictation phrases <10s, 15s is generous)
- [x] Document known terminal limitations
  - Added comprehensive terminal compatibility notes to key-listener.ts
  - Covers Ghostty, iTerm2, tmux, Kitty, web terminals

### T4.3 — Edge cases
- [x] Empty transcription → no injection, no notification (already handled in index.ts)
- [x] Whisper server down → error notification, no crash (already handled with retry in transcriber.ts)
- [x] sox not installed → helpful error message (added `checkSox()` + startup check + ENOENT handling)
- [x] Very short recordings (<0.5s) → skip transcription (already handled: `fileSize < 16000`)
- [x] Terminal too narrow → responsive bar width (already handled: `Math.min(10, Math.max(5, ...))`)

### T4.4 — Text injection refinement
- [x] Smart space insertion (no double spaces, handle newlines)
  - Trims trailing whitespace, adds space only when needed
  - Appends directly after trailing newlines (new paragraph)
- [x] Preserve cursor position after injection
  - Uses `setEditorText` (no cursor API available in ExtensionUIContext)
  - Text appends at end of editor content
- [x] Handle multi-paragraph transcriptions
  - Multi-line text injected naturally (whitespace-aware joining)

### Phase 4 acceptance criteria
- Volume meter responds accurately to quiet/normal/loud speech without jitter.
- Ctrl release fallback timeout is 15s (not 30s).
- All edge cases handled: sox missing, whisper down, empty result, short recording, narrow terminal.
- Text injection avoids double spaces and handles newlines correctly.

---

## Phase 5: Testing and Documentation

### T5.1 — Manual test scenarios
- [x] Dictate a single sentence in English
- [x] Dictate in a different language (e.g., Chinese, Japanese)
- [x] Dictate while editor already has content (append)
- [x] Abort mid-recording with Escape
- [x] Trigger Ctrl+C during recording (N/A — switched to Ctrl+G, no Ctrl conflicts)
- [x] Test with Whisper server stopped (error handling)
- [x] Rapid press-release (<300ms) → no recording triggered

### T5.2 — README
- [x] Write `README.md`: what it is, how to install, how to use
- [x] Include prerequisites (sox, whisper server)
- [x] Include usage instructions and key bindings

### T5.3 — Final review
- [x] Re-read all docs for accuracy against implemented code
- [x] Updated PRD: Ctrl+G trigger, heartbeat release detection, resolved open questions
- [x] Updated ARCHITECTURE: key detection section, data flow, integration points, resolved questions
- [x] Verified all WORKPLAN tasks are checked off

---

## Prototype Definition of Done

- [x] Hold Ctrl+G ≥300ms → recording starts, volume bar visible and reactive
- [x] Release Ctrl → transcription completes, text appears in editor
- [x] Works in Ghostty terminal on Apple Silicon Mac
- [x] No crashes on error conditions
- [x] README explains setup and usage
