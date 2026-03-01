/**
 * Lyrics cleaner — lowercases, removes punctuation, and transliterates
 * Devanagari (Hindi) text to Hinglish (romanized Latin script).
 */

const PUNCTUATION_RE = /[.,!?;:'"()\[\]{}\-—–…\u201C\u201D\u2018\u2019\u00AB\u00BB\u2039\u203A&@#$%^*+=|\\/\<>~`]/g;

// Devanagari to Latin transliteration map
const DEVANAGARI_MAP: Record<string, string> = {
    // Vowels
    '\u0905': 'a', '\u0906': 'aa', '\u0907': 'i', '\u0908': 'ee', '\u0909': 'u', '\u090A': 'oo',
    '\u090F': 'e', '\u0910': 'ai', '\u0913': 'o', '\u0914': 'au',
    // Consonants
    '\u0915': 'ka', '\u0916': 'kha', '\u0917': 'ga', '\u0918': 'gha', '\u0919': 'nga',
    '\u091A': 'cha', '\u091B': 'chha', '\u091C': 'ja', '\u091D': 'jha', '\u091E': 'nya',
    '\u091F': 'ta', '\u0920': 'tha', '\u0921': 'da', '\u0922': 'dha', '\u0923': 'na',
    '\u0924': 'ta', '\u0925': 'tha', '\u0926': 'da', '\u0927': 'dha', '\u0928': 'na',
    '\u092A': 'pa', '\u092B': 'pha', '\u092C': 'ba', '\u092D': 'bha', '\u092E': 'ma',
    '\u092F': 'ya', '\u0930': 'ra', '\u0932': 'la', '\u0935': 'va',
    '\u0936': 'sha', '\u0937': 'sha', '\u0938': 'sa', '\u0939': 'ha',
    // Nukta variants
    '\u0921\u093C': 'da', '\u0922\u093C': 'dha', '\u092B\u093C': 'fa', '\u091C\u093C': 'za', '\u0917\u093C': 'ga',
    // Matras (vowel signs)
    '\u093E': 'aa', '\u093F': 'i', '\u0940': 'ee', '\u0941': 'u', '\u0942': 'oo',
    '\u0947': 'e', '\u0948': 'ai', '\u094B': 'o', '\u094C': 'au',
    // Anusvara, Chandrabindu, Visarga
    '\u0902': 'n', '\u0901': 'n', '\u0903': 'h',
    // Halant (suppresses inherent vowel)
    '\u094D': '',
    // Special
    '\u090B': 'ri', '\u0943': 'ri',
};

const DEVANAGARI_RE = /[\u0900-\u097F]/;

function transliterateHindi(text: string): string {
    if (!DEVANAGARI_RE.test(text)) return text;

    let result = '';
    const chars = [...text];
    for (let i = 0; i < chars.length; i++) {
        const ch = chars[i];
        // Try two-char combo first (for nukta variants)
        if (i + 1 < chars.length) {
            const combo = ch + chars[i + 1];
            if (DEVANAGARI_MAP[combo] !== undefined) {
                result += DEVANAGARI_MAP[combo];
                i++;
                continue;
            }
        }
        if (DEVANAGARI_MAP[ch] !== undefined) {
            result += DEVANAGARI_MAP[ch];
        } else {
            result += ch;
        }
    }
    return result;
}

export function cleanLine(line: string): string {
    let cleaned = line.toLowerCase();
    cleaned = transliterateHindi(cleaned);
    cleaned = cleaned
        .replace(PUNCTUATION_RE, '')
        .replace(/\s+/g, ' ')
        .trim();
    return cleaned;
}

export function cleanAllLyrics(lines: { time: number; text: string }[]): { time: number; text: string }[] {
    return lines
        .map(line => ({
            time: line.time,
            text: cleanLine(line.text),
        }))
        .filter(line => line.text.length > 0);
}
