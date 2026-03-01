import { SyncedLine, WordSegment } from '../types';

/**
 * Parse LRC-formatted subtitle text into SyncedLine[]
 * LRC format: [mm:ss.xx] text
 */
export function parseLRC(lrcText: string): SyncedLine[] {
    const lines: SyncedLine[] = [];
    const regex = /\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/g;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(lrcText)) !== null) {
        const minutes = parseInt(match[1], 10);
        const seconds = parseInt(match[2], 10);
        const centiseconds = match[3].length === 2
            ? parseInt(match[3], 10) * 10
            : parseInt(match[3], 10);
        const time = minutes * 60 + seconds + centiseconds / 1000;
        const text = match[4].trim();
        if (text.length > 0) {
            lines.push({ time, text });
        }
    }

    return lines.sort((a, b) => a.time - b.time);
}

/**
 * Parse plain (non-synced) lyrics into SyncedLine[] with estimated timestamps.
 * Distributes lines evenly across the given duration.
 */
export function parsePlainLyrics(text: string, duration: number): SyncedLine[] {
    const rawLines = text
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0);

    if (rawLines.length === 0) return [];

    const interval = duration / rawLines.length;

    return rawLines.map((line, i) => ({
        time: i * interval,
        text: line,
    }));
}

/**
 * Convert SyncedLine[] into WordSegment[] with estimated per-word timestamps.
 * Words within a line are distributed proportionally by character count.
 */
export function buildWordSegments(lines: SyncedLine[], totalDuration: number): WordSegment[] {
    const segments: WordSegment[] = [];
    let globalIndex = 0;

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const line = lines[lineIdx];
        const lineEnd = lineIdx < lines.length - 1
            ? lines[lineIdx + 1].time
            : totalDuration;
        const lineDuration = Math.max(lineEnd - line.time, 0.1);

        const words = line.text.split(/\s+/).filter(w => w.length > 0);
        if (words.length === 0) continue;

        const totalChars = words.reduce((sum, w) => sum + w.length, 0);
        let charOffset = 0;

        for (let wordIdx = 0; wordIdx < words.length; wordIdx++) {
            const word = words[wordIdx];
            const wordStart = line.time + (charOffset / totalChars) * lineDuration;
            charOffset += word.length;
            const wordEnd = line.time + (charOffset / totalChars) * lineDuration;

            segments.push({
                word,
                lineIndex: lineIdx,
                wordIndex: wordIdx,
                globalIndex,
                startTime: wordStart,
                endTime: wordEnd,
                duration: wordEnd - wordStart,
            });

            globalIndex++;
        }
    }

    return segments;
}
