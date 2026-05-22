// Trigger key detection via onTerminalInput
//
// Trigger key: Ctrl+G
// - Not used by macOS (unlike Ctrl+Space = language switch)
// - Not bound to any pi keybinding
// - In legacy terminal mode: Ctrl+G = \x07 (BEL, ASCII 7)
//
// Release detection: key repeat heartbeat.
// While held, Ctrl+G sends \x07 every ~20ms (key repeat).
// When repeats stop, a 200ms gap triggers release → stop recording.
// Fallback: 15s hard timeout.
//
// Terminal compatibility notes:
// Ghostty, iTerm2, Kitty: Ctrl+G → \x07, detected reliably.
// tmux: Breaks key event propagation. Run pi outside tmux.
//
// macOS microphone permission:
//   - sox needs microphone access. macOS will prompt on first recording.
//   - If denied, recording will fail. Grant in: System Settings → Privacy & Security → Microphone

import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { matchesKey, isKeyRelease, isKeyRepeat } from "@earendil-works/pi-tui";

const TRIGGER_KEY = "ctrl+g";
const TRIGGER_LEGACY_BYTE = "\x07";  // Ctrl+G in legacy mode = BEL

/**
 * Set up the key listener for the voin extension.
 * Uses onTerminalInput (no overlay) to avoid blocking editor input.
 * Returns a cleanup function.
 */
export async function setupKeyListener(
	ui: ExtensionUIContext,
	onTriggerPress: () => void,
	onTriggerRelease: () => void,
	onRepeatHeartbeat: () => void,
	onEscape: () => void,
): Promise<{ cleanup: () => void }> {
	// onTerminalInput fires for all terminal input regardless of focus.
	// No overlay needed — this avoids blocking editor typing.
	const unsubscribe = ui.onTerminalInput((data) => {
		// Detect trigger key (Ctrl+G) — every event counts
		const isTriggerKey =
			matchesKey(data, TRIGGER_KEY) ||
			data === TRIGGER_LEGACY_BYTE;

		if (isTriggerKey && !isKeyRelease(data)) {
			// Call both: triggerPressed() handles IDLE→PENDING→RECORDING flow,
			// repeatHeartbeat() handles release detection during RECORDING.
			// In legacy mode, isKeyRepeat() always returns false for raw bytes,
			// so we can't distinguish press from repeat — call both, state machine filters.
			onTriggerPress();
			onRepeatHeartbeat();
			return { consume: true };
		}

		// Detect Escape — don't consume, pi needs it
		if (data === "escape" || data === "\x1b") {
			onEscape();
			return { consume: false };
		}

		return undefined; // Don't consume other input — editor gets it
	});

	return {
		cleanup: () => {
			unsubscribe();
		},
	};
}
