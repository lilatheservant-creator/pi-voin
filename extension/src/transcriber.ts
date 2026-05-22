// Speech recognition via local Whisper server
// - transcribe(wavPath, signal?): POST WAV to http://127.0.0.1:8002/transcribe
// - Returns { text, language, duration }
// - Handle network errors, 500, timeout

import { readFileSync } from "node:fs";

const WHISPER_URL = "http://127.0.0.1:8002/transcribe";

export interface TranscriptionResult {
	text: string;
	language: string;
	duration: number;
}

/**
 * Transcribe a WAV file by POSTing it to the local Whisper server.
 * Supports abort via AbortSignal.
 * Retries once on failure.
 */
export async function transcribe(
	wavPath: string,
	signal?: AbortSignal,
): Promise<TranscriptionResult> {
	// Read WAV file as binary
	const wavData = readFileSync(wavPath);

	// Build multipart/form-data manually (no fetch Body in all Node versions)
	const boundary = `----voin-boundary-${Date.now()}`;

	// WAV file part
	const wavFileName = "recording.wav";
	const wavPart = [
		`--${boundary}`,
		`Content-Disposition: form-data; name="file"; filename="${wavFileName}"`,
		"Content-Type: audio/wav",
		"",
		wavData.toString("binary"),
	].join("\r\n");

	// Close boundary
	const closeBoundary = `\r\n--${boundary}--\r\n`;

	// Combine into body
	const bodyBuffer = Buffer.from(
		wavPart + closeBoundary,
		"binary",
	);

	const headers: Record<string, string> = {
		"Content-Type": `multipart/form-data; boundary=${boundary}`,
	};

	const controller = signal
		? undefined
		: new AbortController();

	// Merge signals: if user provided a signal, abort when either fires
	const mergedSignal = mergeSignals(
		[signal, controller?.signal].filter((s): s is AbortSignal => s !== undefined),
	);

	const retries = 2; // Try twice total
	let lastError: Error | null = null;

	for (let attempt = 0; attempt < retries; attempt++) {
		try {
			const response = await fetch(WHISPER_URL, {
				method: "POST",
				headers,
				body: bodyBuffer,
				signal: mergedSignal,
			});

			if (!response.ok) {
				throw new Error(`Whisper server returned ${response.status}: ${response.statusText}`);
			}

			const data = (await response.json()) as TranscriptionResult;
			return data;
		} catch (err) {
			lastError = err as Error;

			// If aborted, don't retry
			if (lastError.name === "AbortError") {
				throw lastError;
			}

			// If this was the last attempt, throw
			if (attempt === retries - 1) {
				throw lastError;
			}

			// Brief delay before retry
			await sleep(500);
		}
	}

	// Shouldn't reach here, but TypeScript needs it
	throw lastError || new Error("Transcription failed");
}


function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Merge multiple AbortSignals into one. Aborts when any input signal aborts.
 */
function mergeSignals(signals: AbortSignal[]): AbortSignal {
	if (signals.length === 0) return new AbortController().signal;
	if (signals.length === 1) return signals[0]!;

	const controller = new AbortController();

	for (const signal of signals) {
		if (signal.aborted) {
			controller.abort(signal.reason);
			return controller.signal;
		}
		signal.addEventListener("abort", () => controller.abort(signal.reason), {
			once: true,
		});
	}

	return controller.signal;
}
