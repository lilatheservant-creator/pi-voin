// TUI widget renderer for volume meter + status
// - IDLE: "voin  ○" (dim)
// - PENDING: "voin  ◌" (muted)
// - RECORDING: "voin  ● [██████░░░░]" (error dot, text bar)
// - PROCESSING: "voin  ⠋" (animated spinner)

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { TUI, Component } from "@earendil-works/pi-tui";
import { truncateToWidth } from "@earendil-works/pi-tui";

export type VoinState = "IDLE" | "PENDING" | "RECORDING" | "PROCESSING";

// Spinner frames (Braille-style, 12 frames for smooth animation)
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠇", "⠏", "⠋", "⠙", "⠹"];

/**
 * Build a volume bar string: [██████░░░░]
 * @param level 0-10 integer
 * @param width total bar width in cells (default 10)
 */
function volumeBar(level: number, width: number): string {
	const filled = Math.min(width, Math.max(0, level));
	const empty = width - filled;
	return "[" + "█".repeat(filled) + "░".repeat(empty) + "]";
}

/**
 * Create a widget factory for ctx.ui.setWidget().
 * The factory captures the TUI for re-rendering and returns a Component.
 *
 * Returns a controller object for updating the widget state.
 */
export function createVoinWidget(): {
	factory: (tui: TUI, theme: Theme) => Component & { dispose?(): void };
	controller: {
		setState(state: VoinState): void;
		setLevel(level: number): void;
	};
} {
	// Shared mutable state
	let state: VoinState = "IDLE";
	let level = 0;
	let spinnerIndex = 0;
	let spinnerTimer: ReturnType<typeof setInterval> | null = null;

	// Re-render callback — assigned when the factory receives the TUI instance.
	// The controller's setState/setLevel methods use this to trigger re-renders.
	let requestRender: () => void = () => {}; // no-op until factory is called

	const controller = {
		setState(newState: VoinState) {
			state = newState;
			if (state === "PROCESSING" && !spinnerTimer) {
				spinnerTimer = setInterval(() => {
					spinnerIndex = (spinnerIndex + 1) % SPINNER_FRAMES.length;
					requestRender();
				}, 80);
			} else if (state !== "PROCESSING" && spinnerTimer) {
				clearInterval(spinnerTimer);
				spinnerTimer = null;
			}
			requestRender();
		},
		setLevel(newLevel: number) {
			level = newLevel;
			requestRender();
		},
	};

	return {
		factory: (tui: TUI, theme: Theme) => {
			// Wire up the real re-render function now that we have the TUI
			requestRender = () => tui.requestRender?.();

			return {
				invalidate() {},

				render(width: number): string[] {
					// Determine bar width: use available space, min 5, max 10
					const labelWidth = 8; // "voin  ● "
					const available = Math.max(5, width - labelWidth);
					const barWidth = Math.min(10, available);

					let line: string;

					switch (state) {
						case "IDLE":
							line = theme.fg("dim", "voin  ○");
							break;
						case "PENDING":
							line = theme.fg("muted", "voin  ◌");
							break;
						case "RECORDING":
							const bar = volumeBar(level, barWidth);
							line = theme.fg("error", "voin  ● ") + theme.fg("text", bar);
							break;
						case "PROCESSING":
							const frame = SPINNER_FRAMES[spinnerIndex] || "⠋";
							line = theme.fg("accent", `voin  ${frame}`);
							break;
						default:
							line = theme.fg("dim", "voin  ○");
					}

					return [truncateToWidth(line, width, "…")];
				},
			};
		},

		controller,
	};
}
