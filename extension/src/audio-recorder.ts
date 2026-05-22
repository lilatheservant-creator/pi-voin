// Audio recording via sox child process
// - startRecording(): spawn sox, return { process, tempPath }
// - stopRecording(handle): kill sox, return tempPath
// - cleanup(path): delete temp file
// - checkSox(): verify sox is available, throw helpful error if not

import { spawn, ChildProcess } from "node:child_process";
import { unlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface RecordingHandle {
	process: ChildProcess;
	tempPath: string;
}

/**
 * Check that sox is available. Throws a helpful error if not.
 */
export function checkSox(): void {
	try {
		const { execSync } = require("node:child_process");
		execSync("which sox", { stdio: "ignore" });
	} catch {
		throw new Error(
			"sox is not installed. Run: brew install sox",
		);
	}
}

/**
 * Generate a unique temp WAV file path.
 */
function tempWavPath(): string {
	const timestamp = Date.now();
	const pid = process.pid;
	return join(tmpdir(), `voin-${pid}-${timestamp}.wav`);
}

/**
 * Start recording microphone audio to a WAV file using sox.
 * Returns a handle with the child process and temp file path.
 *
 * Listens for the process's "error" event to catch ENOENT (sox not found)
 * and other spawn failures. Errors are emitted asynchronously and will be
 * caught by the caller's stopRecording promise.
 */
export function startRecording(): RecordingHandle {
	const tempPath = tempWavPath();
	const process = spawn("sox", [
		"-d",           // default input device (system mic)
		"-r", "16000",  // Whisper expects 16kHz
		"-c", "1",      // mono
		"-b", "16",     // 16-bit samples
		tempPath,
	]);

	// If sox fails to spawn (e.g., ENOENT), the error event fires.
	// The caller's stopRecording handler will propagate this.
	process.on("error", (err) => {
		const errAny = err as NodeJS.ErrnoException;
		if (errAny.code === "ENOENT") {
			// Rewrite the error message to be helpful
			throw new Error("sox is not installed. Run: brew install sox");
		}
	});

	return { process, tempPath };
}

/**
 * Stop recording by killing the sox process.
 * Waits for process exit, returns the temp file path.
 */
export function stopRecording(handle: RecordingHandle): Promise<string> {
	return new Promise((resolve, reject) => {
		const { process: sox, tempPath } = handle;

		// Handle errors (including ENOENT from startRecording)
		sox.on("error", (err) => {
			reject(new Error(`sox process error: ${err.message}`));
		});

		// Resolve when process exits
		sox.on("exit", (code, signal) => {
			// sox exits normally after SIGTERM, or with signal
			// Either way, the WAV file should be valid
			resolve(tempPath);
		});

		// Kill sox gracefully (SIGTERM), fallback to SIGKILL after 2s
		sox.kill("SIGTERM");
		setTimeout(() => {
			if (!sox.killed) {
				sox.kill("SIGKILL");
			}
		}, 2000);
	});
}

/**
 * Delete a temp WAV file. Silently ignores if file doesn't exist.
 */
export function cleanup(path: string): void {
	try {
		if (existsSync(path)) {
			unlinkSync(path);
		}
	} catch {
		// Ignore cleanup errors (file may already be gone)
	}
}
