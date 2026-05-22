// State machine: IDLE → PENDING → RECORDING → PROCESSING → IDLE
// Shared between key-listener, audio-recorder, transcriber, widget

import type { VoinState } from "./widget";

export interface VoinWidgetController {
	setState(state: VoinState): void;
	setLevel(level: number): void;
}

/**
 * State machine for the voin extension.
 * Manages transitions and widget updates.
 *
 * Trigger key: Ctrl+G (hold ≥300ms to start recording).
 * Release detection: key repeat heartbeat (repeats stop when Ctrl released).
 *
 * Ctrl+G was chosen because:
 * - Not intercepted by macOS (unlike Ctrl+Space = language switch)
 * - Not bound to any pi keybinding
 * - Works reliably via onTerminalInput (\x07 BEL byte)
 *
 * Release detection: While recording, Ctrl+G key repeat sends \x07 every ~20ms.
 * When repeats stop (user releases Ctrl), a 200ms gap triggers stop.
 * Fallback: 15s hard timeout if detection fails.
 */

// Key repeat heartbeat timeout — if no \x07 received within this window, assume Ctrl released.
const REPEAT_HEARTBEAT_MS = 200;
// Hard timeout as safety net.
const RELEASE_TIMEOUT_MS = 15_000;

/**
 * State machine for the voin extension.
 */
export class VoinMachine {
	private _state: VoinState = "IDLE";
	private pendingTimer: ReturnType<typeof setTimeout> | null = null;
	private releaseTimeout: ReturnType<typeof setTimeout> | null = null;
	private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;

	// Callbacks
	onRecordingStart: (() => void) | null = null;
	onRecordingStop: ((reason: "release" | "escape" | "timeout") => void) | null = null;

	constructor(public widgetCtrl: VoinWidgetController) {
		this.widgetCtrl.setState("IDLE");
	}

	get state(): VoinState {
		return this._state;
	}

	/** Called when trigger key (Ctrl+G) is pressed */
	triggerPressed(): void {
		if (this._state !== "IDLE") return;

		this._state = "PENDING";
		this.widgetCtrl.setState("PENDING");

		this.pendingTimer = setTimeout(() => {
			this.pendingTimer = null;
			if (this._state === "PENDING") {
				this.doTransition("RECORDING");
				this.onRecordingStart?.();
			}
		}, 300);
	}

	/** Called when another key is pressed while in PENDING — cancel recording */
	triggerComboPressed(): void {
		if (this._state === "PENDING" && this.pendingTimer) {
			clearTimeout(this.pendingTimer);
			this.pendingTimer = null;
			this.doTransition("IDLE");
		}
	}

	/** Called when trigger key is released (legacy, not used with heartbeat detection) */
	triggerReleased(): void {
		// Heartbeat detection handles release. This is kept for API compatibility.
		if (this._state === "PENDING" && this.pendingTimer) {
			clearTimeout(this.pendingTimer);
			this.pendingTimer = null;
			this.doTransition("IDLE");
			return;
		}
		if (this._state === "RECORDING") {
			this.clearHeartbeatTimer();
			this.clearReleaseTimeout();
			this.onRecordingStop?.("release");
		}
	}

	/** Called when Escape is pressed */
	escapePressed(): void {
		if (this._state === "RECORDING") {
			this.clearReleaseTimeout();
			this.onRecordingStop?.("escape");
		} else if (this._state === "PROCESSING") {
			this.onRecordingStop?.("escape");
		}
	}

	/** Set the volume level (called by level monitor) */
	setLevel(level: number): void {
		this.widgetCtrl.setLevel(level);
	}

	/** Called when a Ctrl+G key event is received (press or repeat).
	 * Resets the heartbeat timer — if events stop within HEARTBEAT_MS, assume release.
	 * Only active during RECORDING state. During PENDING, the pending timer handles timing. */
	repeatHeartbeat(): void {
		if (this._state === "RECORDING") {
			this.clearHeartbeatTimer();
			this.heartbeatTimer = setTimeout(() => {
				this.heartbeatTimer = null;
				if (this._state === "RECORDING") {
					// No more \x07 events — user released Ctrl
					this.onRecordingStop?.("release");
				}
			}, REPEAT_HEARTBEAT_MS);
		}
		// In IDLE/PENDING/PROCESSING: ignore (pending timer or other logic handles it)
	}

	/** Transition to a new state (public for the extension entry point) */
	setState(newState: VoinState): void {
		this.doTransition(newState);
	}

	/** Start the auto-stop timeout (fallback if release isn't detected) */
	startReleaseTimeout(): void {
		this.clearReleaseTimeout();
		this.releaseTimeout = setTimeout(() => {
			if (this._state === "RECORDING") {
				this.onRecordingStop?.("timeout");
			}
		}, RELEASE_TIMEOUT_MS);
	}

	/** Clean up all timers */
	destroy(): void {
		if (this.pendingTimer) clearTimeout(this.pendingTimer);
		this.clearReleaseTimeout();
		this.clearHeartbeatTimer();
	}

	private doTransition(newState: VoinState): void {
		this._state = newState;
		this.widgetCtrl.setState(newState);

		if (newState === "RECORDING") {
			this.startReleaseTimeout();
		} else {
			this.clearReleaseTimeout();
			this.clearHeartbeatTimer();
		}
	}

	private clearReleaseTimeout(): void {
		if (this.releaseTimeout) {
			clearTimeout(this.releaseTimeout);
			this.releaseTimeout = null;
		}
	}

	private clearHeartbeatTimer(): void {
		if (this.heartbeatTimer) {
			clearTimeout(this.heartbeatTimer);
			this.heartbeatTimer = null;
		}
	}
}
