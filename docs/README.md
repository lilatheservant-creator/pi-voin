# pi-voin Documentation

## Overview

pi-voin is a **push-to-talk voice dictation extension** for the pi-agent terminal. Hold Ctrl, speak, release — text appears in the editor. Uses local Whisper (MLX) on Apple Silicon.

## Documents

| Doc | What it covers |
|-----|---------------|
| [Requirements (PRD)](./requirements/PRD.md) | Problem statement, goals, functional/non-functional requirements, use cases |
| [Architecture](./design/ARCHITECTURE.md) | System design, component architecture, data flow, error handling |
| [Work Plan](./tasks/WORKPLAN.md) | Phase-by-phase tasks with acceptance criteria |
| [Orchestra](./orchestra.md) | Multi-agent cooperation protocol (PM → Phase Managers → Workers → Testers) |

## Quick Reference

- **Trigger**: Hold Ctrl ≥300ms → record. Release Ctrl → transcribe & inject.
- **Abort**: Escape during recording/processing.
- **Backend**: Local Whisper server on `http://127.0.0.1:8001` (MLX, `whisper-large-v3-turbo`).
- **UI**: Widget below editor with volume bar meter.
- **Platform**: macOS, Apple Silicon only.
