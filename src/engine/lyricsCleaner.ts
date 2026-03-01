/**
 * Lyrics cleaner — only lowercases and removes punctuation.
 * Keeps all words including repetitive ones. Lyrics should look real.
 */

const PUNCTUATION_RE = /[.,!?;:'"()\[\]{}\-—–…""''«»‹›&@#$%^*+=|\\/<>~`]/g;

export function cleanLine(line: string): string {
    return line
        .toLowerCase()
        .replace(PUNCTUATION_RE, '')
        .replace(/\s+/g, ' ')
        .trim();
}

export function cleanAllLyrics(lines: { time: number; text: string }[]): { time: number; text: string }[] {
    return lines
        .map(line => ({
            time: line.time,
            text: cleanLine(line.text),
        }))
        .filter(line => line.text.length > 0);
}
