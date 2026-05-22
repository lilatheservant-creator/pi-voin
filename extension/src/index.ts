// pi-voin extension entry point
// Session lifecycle hooks, wire all components together

import type { ExtensionAPI, ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { VoinMachine } from "./state";
import { createVoinWidget } from "./widget";
import { setupKeyListener } from "./key-listener";
import { startRecording, stopRecording, cleanup, checkSox } from "./audio-recorder";
import { startMonitoring } from "./level-monitor";
import { transcribe } from "./transcriber";

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) {
			return; // No UI in non-interactive modes
		}

		// Check prerequisites before loading
		try {
			checkSox();
		} catch (err: any) {
			ctx.ui.notify(err.message, "error");
			return; // Don't load the extension if sox is missing
		}

		ctx.ui.notify("voin loaded — Ctrl+G to dictate", "info");

		// Create widget
		const { factory, controller } = createVoinWidget();
		ctx.ui.setWidget("voin", factory, { placement: "belowEditor" });

		// Create state machine
		const machine = new VoinMachine(controller);

		// Recording state
		let recordingHandle: ReturnType<typeof startRecording> | null = null;
		let stopMonitoring: (() => void) | null = null;
		let abortController: AbortController | null = null;

		// Wire recording start
		machine.onRecordingStart = () => {
			try {
				recordingHandle = startRecording();
				stopMonitoring = startMonitoring(recordingHandle.tempPath, 100, (level) => {
					machine.setLevel(level);
				});
			} catch (err: any) {
				ctx.ui.notify(`voin: ${err.message || "recording failed"}`, "error");
				machine.setState("IDLE");
			}
		};

		// Wire recording stop
		machine.onRecordingStop = async (reason) => {
			// Stop monitoring first
			if (stopMonitoring) {
				stopMonitoring();
				stopMonitoring = null;
			}

			if (reason === "escape") {
				// Discard audio
				if (recordingHandle) {
					try {
						await stopRecording(recordingHandle);
						cleanup(recordingHandle.tempPath);
					} catch { /* ignore */ }
					recordingHandle = null;
					ctx.ui.notify("voin: recording cancelled", "info");
				}
				machine.setState("IDLE");
				return;
			}

			// Stop recording and transcribe
			if (recordingHandle) {
				machine.setState("PROCESSING");

				try {
					const wavPath = await stopRecording(recordingHandle);
					recordingHandle = null;

					// Check minimum duration (skip very short recordings)
					const { statSync } = await import("node:fs");
					const fileSize = statSync(wavPath).size;
					// ~32000 bytes for 1 second (16kHz * 2 bytes * 1 channel)
					// 16000 bytes ≈ 0.5s — skip anything shorter
					if (fileSize < 16000) {
						// Less than ~0.5s of audio, skip silently
						cleanup(wavPath);
						machine.setState("IDLE");
						return;
					}

					// Transcribe
					abortController = new AbortController();
					const result = await transcribe(wavPath, abortController.signal);
					abortController = null;

					// Clean up temp file
					cleanup(wavPath);

					// Inject text if we got something meaningful
					if (result.text && result.text.trim()) {
						injectText(ctx.ui, result.text.trim());
						const preview = result.text.trim().length > 40
							? result.text.trim().slice(0, 40) + "…"
							: result.text.trim();
						ctx.ui.notify(`voin: "${preview}"`, "info");
					}
					// Empty transcription: silently discard (no injection, no notification)
				} catch (err: any) {
					if (err.name === "AbortError") {
						ctx.ui.notify("voin: transcription cancelled", "info");
					} else {
						ctx.ui.notify(`voin: ${err.message || "transcription failed"}`, "error");
					}
				}

				machine.setState("IDLE");
			}
		};

		// Set up key listener
		const { cleanup: cleanupKeys } = await setupKeyListener(
			ctx.ui,
			() => machine.triggerPressed(),
			() => machine.triggerReleased(),
			() => machine.repeatHeartbeat(),
			() => machine.escapePressed(),
		);

		// Store cleanup on the machine for session lifecycle
		(machine as any)._cleanupKeys = cleanupKeys;

		// Clean up on session switch
		pi.on("session_before_switch", () => {
			if (machine.state !== "IDLE") {
				// Stop any ongoing recording
				if (recordingHandle) {
					stopRecording(recordingHandle).then(cleanup).catch(() => {});
					recordingHandle = null;
				}
				if (abortController) {
					abortController.abort();
					abortController = null;
				}
				if (stopMonitoring) {
					stopMonitoring();
					stopMonitoring = null;
				}
				machine.setState("IDLE");
			}
			cleanupKeys();
			machine.destroy();
		});
	});
}

/**
 * Inject transcribed text into the editor with smart spacing.
 *
 * Rules:
 * - If editor is empty → insert text as-is
 * - If editor ends with a newline → append text directly (new paragraph)
 * - If editor ends with whitespace (spaces, tabs) → trim trailing whitespace,
 *   then add a single space before the new text
 * - If editor ends with a letter/digit → add " " before new text
 * - If editor ends with punctuation → add " " before new text
 *
 * This avoids double spaces, handles multi-paragraph transcriptions naturally,
 * and preserves the editor's existing formatting.
 */
function injectText(ui: ExtensionUIContext, text: string): void {
	const existing = ui.getEditorText();
	if (!existing) {
		ui.setEditorText(text);
		return;
	}

	// Trim trailing whitespace from existing content to avoid double spaces
	const trimmed = existing.replace(/[\t\f\r ]+$/, "");
	const endsWithNewline = trimmed.endsWith("\n");

	let injected: string;
	if (endsWithNewline) {
		// Editor ends with a newline — append directly (new paragraph/line)
		injected = trimmed + text;
	} else {
		// Editor has content on the current line — add a space separator
		injected = trimmed + " " + text;
	}

	ui.setEditorText(injected);
}
