import { WordSegment } from '../types';

/**
 * AudioEngine — Per-word audio segment player using Web Audio API.
 *
 * Key design:
 * - Each word has an absolute start/end time in the audio buffer.
 * - When a word is completed, we play the NEXT word's segment.
 * - PlaybackRate is adjusted based on how fast/slow the user typed.
 * - Each word is an independent anchor — no cumulative drift.
 * - GainNode with micro-fades prevents click artifacts.
 */
export class AudioEngine {
    private ctx: AudioContext | null = null;
    private buffer: AudioBuffer | null = null;
    private currentSource: AudioBufferSourceNode | null = null;
    private currentGain: GainNode | null = null;
    private isPlaying = false;

    /** Initialize AudioContext (must be called from user gesture) */
    async init(): Promise<void> {
        if (!this.ctx) {
            this.ctx = new AudioContext();
        }
        if (this.ctx.state === 'suspended') {
            await this.ctx.resume();
        }
    }

    /** Load an audio file (MP3/WAV) into the buffer */
    async loadFile(file: File): Promise<number> {
        await this.init();
        const arrayBuffer = await file.arrayBuffer();
        this.buffer = await this.ctx!.decodeAudioData(arrayBuffer);
        return this.buffer.duration;
    }

    /** Load from an ArrayBuffer directly */
    async loadBuffer(arrayBuffer: ArrayBuffer): Promise<number> {
        await this.init();
        this.buffer = await this.ctx!.decodeAudioData(arrayBuffer);
        return this.buffer.duration;
    }

    /** Get the loaded buffer duration */
    getDuration(): number {
        return this.buffer?.duration ?? 0;
    }

    /** Check if audio is loaded */
    hasAudio(): boolean {
        return this.buffer !== null;
    }

    /**
     * Play a word's audio segment with adjusted playback rate.
     *
     * @param segment - The word segment to play
     * @param typingDurationMs - How long the user took to type this word (ms)
     */
    playWordSegment(segment: WordSegment, typingDurationMs: number, baseRate = 1): void {
        if (!this.ctx || !this.buffer) return;

        // Stop any currently playing segment
        this.stopCurrent();

        const expectedDurationMs = segment.duration * 1000;
        let rate = (expectedDurationMs / typingDurationMs) * baseRate;

        // Clamp playback rate between 0.5x and 1.75x
        rate = Math.max(0.5, Math.min(1.75, rate));

        // Ensure we don't go past buffer bounds
        const startOffset = Math.max(0, Math.min(segment.startTime, this.buffer.duration));
        const segmentDuration = Math.max(0.01, segment.endTime - segment.startTime);
        const playDuration = segmentDuration / rate;

        // Create source node
        const source = this.ctx.createBufferSource();
        source.buffer = this.buffer;
        source.playbackRate.value = rate;

        // Create gain node for micro-fades
        const gain = this.ctx.createGain();
        const now = this.ctx.currentTime;
        const fadeTime = 0.008; // 8ms fade

        // Fade in
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(1, now + fadeTime);

        // Fade out before end
        const fadeOutStart = now + playDuration - fadeTime;
        if (fadeOutStart > now + fadeTime) {
            gain.gain.setValueAtTime(1, fadeOutStart);
            gain.gain.linearRampToValueAtTime(0, fadeOutStart + fadeTime);
        }

        // Connect: source → gain → destination
        source.connect(gain);
        gain.connect(this.ctx.destination);

        // Play the segment
        source.start(now, startOffset, segmentDuration);

        source.onended = () => {
            this.isPlaying = false;
            source.disconnect();
            gain.disconnect();
        };

        this.currentSource = source;
        this.currentGain = gain;
        this.isPlaying = true;
    }

    /**
     * Play the NEXT word's segment when the current word is completed.
     * Adjusts playback rate based on how fast the user typed the current word.
     */
    onWordComplete(
        completedSegment: WordSegment,
        nextSegment: WordSegment | null,
        typingDurationMs: number,
        baseRate = 1
    ): void {
        if (!nextSegment) {
            this.stopCurrent();
            return;
        }
        this.playWordSegment(nextSegment, typingDurationMs, baseRate);
    }

    /** Start playing from the first word at normal speed */
    playFirstWord(segment: WordSegment, baseRate = 1): void {
        if (!this.ctx || !this.buffer) return;
        this.stopCurrent();

        const source = this.ctx.createBufferSource();
        source.buffer = this.buffer;
        source.playbackRate.value = Math.max(0.5, Math.min(1.75, baseRate));

        const gain = this.ctx.createGain();
        const now = this.ctx.currentTime;
        const fadeTime = 0.008;

        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(1, now + fadeTime);

        const segDuration = segment.endTime - segment.startTime;
        const fadeOutStart = now + segDuration - fadeTime;
        if (fadeOutStart > now + fadeTime) {
            gain.gain.setValueAtTime(1, fadeOutStart);
            gain.gain.linearRampToValueAtTime(0, fadeOutStart + fadeTime);
        }

        source.connect(gain);
        gain.connect(this.ctx.destination);
        source.start(now, segment.startTime, segDuration);

        source.onended = () => {
            this.isPlaying = false;
            source.disconnect();
            gain.disconnect();
        };

        this.currentSource = source;
        this.currentGain = gain;
        this.isPlaying = true;
    }

    /** Stop current playback cleanly */
    private stopCurrent(): void {
        if (this.currentSource) {
            try {
                // Quick fade out to prevent click
                if (this.currentGain && this.ctx) {
                    const now = this.ctx.currentTime;
                    this.currentGain.gain.cancelScheduledValues(now);
                    this.currentGain.gain.setValueAtTime(
                        this.currentGain.gain.value,
                        now
                    );
                    this.currentGain.gain.linearRampToValueAtTime(0, now + 0.005);
                }
                this.currentSource.stop(this.ctx ? this.ctx.currentTime + 0.01 : 0);
            } catch {
                // Source may have already stopped
            }
            this.currentSource = null;
            this.currentGain = null;
        }
        this.isPlaying = false;
    }

    /** Public stop without destroying loaded buffer */
    stop(): void {
        this.stopCurrent();
    }

    /** Stop all playback and release resources */
    destroy(): void {
        this.stopCurrent();
        if (this.ctx) {
            this.ctx.close();
            this.ctx = null;
        }
        this.buffer = null;
    }

    /** Check if currently playing */
    getIsPlaying(): boolean {
        return this.isPlaying;
    }
}

// Singleton instance
let engineInstance: AudioEngine | null = null;

export function getAudioEngine(): AudioEngine {
    if (!engineInstance) {
        engineInstance = new AudioEngine();
    }
    return engineInstance;
}
