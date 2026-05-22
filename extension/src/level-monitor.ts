// Real-time volume level monitoring
// - sampleLevel(wavPath): read WAV PCM data, compute RMS → 0-10
// - startMonitoring(wavPath, intervalMs, callback): poll at interval
// - Return unsubscribe function
//
// Calibration notes:
//   System mic (MacBook) typical RMS levels:
//     - Silence / room noise:     0 – 300
//     - Quiet speech (distant):   300 – 1500
//     - Normal speech (close):    1500 – 12000
//     - Loud speech / shouting:   12000 – 28000
//   We map this to a 0–10 bar with a logarithmic curve so that
//   quiet speech is visible without dominating the meter.

import { statSync } from "node:fs";
import { openSync, readSync, closeSync } from "node:fs";

/**
 * Read raw PCM samples from the end of a WAV file.
 * WAV files have a 44-byte header (standard RIFF), then 2 bytes per sample (16-bit).
 * We read the last N samples to get the most recent audio chunk.
 */
function readPcmTail(wavPath: string, sampleCount: number): Int16Array {
	try {
		const stat = statSync(wavPath);
		const bytesPerSample = 2; // 16-bit
		const pcmBytes = sampleCount * bytesPerSample;
		const totalBytes = stat.size;

		// Need at least the WAV header + some samples
		if (totalBytes < 44 + pcmBytes) {
			return new Int16Array(0);
		}

		// Read the last pcmBytes from the file (skip header)
		const fd = openSync(wavPath, "r");
		const buffer = Buffer.alloc(pcmBytes);
		readSync(fd, buffer, 0, pcmBytes, totalBytes - pcmBytes);
		closeSync(fd);

		// Convert to Int16Array (little-endian)
		const samples = new Int16Array(sampleCount);
		for (let i = 0; i < sampleCount; i++) {
			samples[i] = buffer.readInt16LE(i * 2);
		}
		return samples;
	} catch {
		return new Int16Array(0);
	}
}

/**
 * Map RMS amplitude to a 0–10 display level using a logarithmic curve.
 *
 * Calibrated for typical MacBook system mic levels:
 *   RMS < 400    →  0  (silence / room noise)
 *   RMS ~800     →  1  (very quiet)
 *   RMS ~2000    →  3  (quiet speech)
 *   RMS ~6000    →  5  (normal speech)
 *   RMS ~15000   →  8  (loud speech)
 *   RMS > 26000  → 10  (near full-scale)
 */
function rmsToLevel(rms: number): number {
	if (rms < 400) return 0;
	const minRms = 400;
	const maxRms = 26000;
	// Logarithmic mapping: level = 10 * log10(rms / minRms) / log10(maxRms / minRms)
	// Maps 400→0, ~26000→10. Intermediate values follow a log curve
	// that matches perceived loudness.
	const logRatio = Math.log10(rms / minRms) / Math.log10(maxRms / minRms);
	return Math.min(10, Math.max(0, Math.round(10 * logRatio)));
}

/**
 * Sample the current volume level from a WAV file.
 * Returns 0-10 integer representing volume level.
 */
export function sampleLevel(wavPath: string): number {
	// Read last ~1600 samples (100ms at 16kHz)
	const samples = readPcmTail(wavPath, 1600);
	if (samples.length === 0) return 0;

	// Compute RMS
	let sumSquares = 0;
	for (let i = 0; i < samples.length; i++) {
		sumSquares += samples[i] * samples[i];
	}
	const rms = Math.sqrt(sumSquares / samples.length);
	return rmsToLevel(rms);
}

/**
 * Start monitoring volume levels at the given interval.
 * Calls callback(level) on each sample.
 * Returns an unsubscribe function to stop monitoring.
 *
 * Uses exponential moving average (EMA) smoothing for responsive
 * yet stable readings. Alpha = 0.55 means ~55% weight to the
 * current sample and ~45% to the previous smoothed value.
 */
export function startMonitoring(
	wavPath: string,
	intervalMs: number,
	callback: (level: number) => void,
): () => void {
	// EMA smoothing state — initialized on first sample
	let smoothed: number | null = null;
	const alpha = 0.55;

	const interval = setInterval(() => {
		const raw = sampleLevel(wavPath);
		if (smoothed === null) {
			smoothed = raw;
		} else {
			// Exponential moving average: responsive to changes,
			// dampens jitter without excessive lag
			smoothed = alpha * raw + (1 - alpha) * smoothed;
		}
		callback(Math.round(smoothed));
	}, intervalMs);

	return () => clearInterval(interval);
}
