/**
 * Lyrics cleaner — lowercases, removes punctuation, and transliterates
 * non-Latin scripts (Devanagari, Gurmukhi, Bengali, Tamil, Telugu, etc.)
 * to Hinglish-style romanized Latin text.
 *
 * Any character that isn't a basic Latin letter (a-z), digit, or space
 * is stripped as a final safety net so only typeable characters remain.
 */

const PUNCTUATION_RE = /[.,!?;:'"()\[\]{}\-—–…\u201C\u201D\u2018\u2019\u00AB\u00BB\u2039\u203A&@#$%^*+=|\\\/<>~`]/g;

// ── Devanagari (Hindi, Marathi, Sanskrit) ──
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

// ── Gurmukhi (Punjabi) ──
const GURMUKHI_MAP: Record<string, string> = {
    '\u0A05': 'a', '\u0A06': 'aa', '\u0A07': 'i', '\u0A08': 'ee', '\u0A09': 'u', '\u0A0A': 'oo',
    '\u0A0F': 'e', '\u0A10': 'ai', '\u0A13': 'o', '\u0A14': 'au',
    '\u0A15': 'ka', '\u0A16': 'kha', '\u0A17': 'ga', '\u0A18': 'gha', '\u0A19': 'nga',
    '\u0A1A': 'cha', '\u0A1B': 'chha', '\u0A1C': 'ja', '\u0A1D': 'jha', '\u0A1E': 'nya',
    '\u0A1F': 'ta', '\u0A20': 'tha', '\u0A21': 'da', '\u0A22': 'dha', '\u0A23': 'na',
    '\u0A24': 'ta', '\u0A25': 'tha', '\u0A26': 'da', '\u0A27': 'dha', '\u0A28': 'na',
    '\u0A2A': 'pa', '\u0A2B': 'pha', '\u0A2C': 'ba', '\u0A2D': 'bha', '\u0A2E': 'ma',
    '\u0A2F': 'ya', '\u0A30': 'ra', '\u0A32': 'la', '\u0A35': 'va',
    '\u0A36': 'sha', '\u0A38': 'sa', '\u0A39': 'ha',
    '\u0A3E': 'aa', '\u0A3F': 'i', '\u0A40': 'ee', '\u0A41': 'u', '\u0A42': 'oo',
    '\u0A47': 'e', '\u0A48': 'ai', '\u0A4B': 'o', '\u0A4C': 'au',
    '\u0A02': 'n', '\u0A01': 'n', '\u0A03': 'h',
    '\u0A4D': '',
};

// ── Bengali ──
const BENGALI_MAP: Record<string, string> = {
    '\u0985': 'a', '\u0986': 'aa', '\u0987': 'i', '\u0988': 'ee', '\u0989': 'u', '\u098A': 'oo',
    '\u098F': 'e', '\u0990': 'oi', '\u0993': 'o', '\u0994': 'ou',
    '\u0995': 'ka', '\u0996': 'kha', '\u0997': 'ga', '\u0998': 'gha', '\u0999': 'nga',
    '\u099A': 'cha', '\u099B': 'chha', '\u099C': 'ja', '\u099D': 'jha', '\u099E': 'nya',
    '\u099F': 'ta', '\u09A0': 'tha', '\u09A1': 'da', '\u09A2': 'dha', '\u09A3': 'na',
    '\u09A4': 'ta', '\u09A5': 'tha', '\u09A6': 'da', '\u09A7': 'dha', '\u09A8': 'na',
    '\u09AA': 'pa', '\u09AB': 'pha', '\u09AC': 'ba', '\u09AD': 'bha', '\u09AE': 'ma',
    '\u09AF': 'ja', '\u09B0': 'ra', '\u09B2': 'la', '\u09B6': 'sha', '\u09B7': 'sha', '\u09B8': 'sa', '\u09B9': 'ha',
    '\u09BE': 'aa', '\u09BF': 'i', '\u09C0': 'ee', '\u09C1': 'u', '\u09C2': 'oo',
    '\u09C7': 'e', '\u09C8': 'oi', '\u09CB': 'o', '\u09CC': 'ou',
    '\u0982': 'ng', '\u0981': 'n', '\u0983': 'h',
    '\u09CD': '',
};

// ── Tamil (basic) ──
const TAMIL_MAP: Record<string, string> = {
    '\u0B85': 'a', '\u0B86': 'aa', '\u0B87': 'i', '\u0B88': 'ee', '\u0B89': 'u', '\u0B8A': 'oo',
    '\u0B8E': 'e', '\u0B8F': 'ee', '\u0B90': 'ai', '\u0B92': 'o', '\u0B93': 'oo', '\u0B94': 'au',
    '\u0B95': 'ka', '\u0B99': 'nga', '\u0B9A': 'cha', '\u0B9C': 'ja', '\u0B9E': 'nya',
    '\u0B9F': 'ta', '\u0BA3': 'na', '\u0BA4': 'tha', '\u0BA8': 'na', '\u0BA9': 'na',
    '\u0BAA': 'pa', '\u0BAE': 'ma', '\u0BAF': 'ya', '\u0BB0': 'ra', '\u0BB1': 'ra',
    '\u0BB2': 'la', '\u0BB3': 'la', '\u0BB4': 'zha', '\u0BB5': 'va', '\u0BB6': 'sha', '\u0BB7': 'sha', '\u0BB8': 'sa', '\u0BB9': 'ha',
    '\u0BBE': 'aa', '\u0BBF': 'i', '\u0BC0': 'ee', '\u0BC1': 'u', '\u0BC2': 'oo',
    '\u0BC6': 'e', '\u0BC7': 'ee', '\u0BC8': 'ai', '\u0BCA': 'o', '\u0BCB': 'oo', '\u0BCC': 'au',
    '\u0BCD': '',
    '\u0B82': 'm',
};

// ── Telugu (basic) ──
const TELUGU_MAP: Record<string, string> = {
    '\u0C05': 'a', '\u0C06': 'aa', '\u0C07': 'i', '\u0C08': 'ee', '\u0C09': 'u', '\u0C0A': 'oo',
    '\u0C0E': 'e', '\u0C0F': 'ee', '\u0C10': 'ai', '\u0C12': 'o', '\u0C13': 'oo', '\u0C14': 'au',
    '\u0C15': 'ka', '\u0C16': 'kha', '\u0C17': 'ga', '\u0C18': 'gha', '\u0C19': 'nga',
    '\u0C1A': 'cha', '\u0C1B': 'chha', '\u0C1C': 'ja', '\u0C1D': 'jha', '\u0C1E': 'nya',
    '\u0C1F': 'ta', '\u0C20': 'tha', '\u0C21': 'da', '\u0C22': 'dha', '\u0C23': 'na',
    '\u0C24': 'ta', '\u0C25': 'tha', '\u0C26': 'da', '\u0C27': 'dha', '\u0C28': 'na',
    '\u0C2A': 'pa', '\u0C2B': 'pha', '\u0C2C': 'ba', '\u0C2D': 'bha', '\u0C2E': 'ma',
    '\u0C2F': 'ya', '\u0C30': 'ra', '\u0C32': 'la', '\u0C35': 'va',
    '\u0C36': 'sha', '\u0C37': 'sha', '\u0C38': 'sa', '\u0C39': 'ha',
    '\u0C3E': 'aa', '\u0C3F': 'i', '\u0C40': 'ee', '\u0C41': 'u', '\u0C42': 'oo',
    '\u0C46': 'e', '\u0C47': 'ee', '\u0C48': 'ai', '\u0C4A': 'o', '\u0C4B': 'oo', '\u0C4C': 'au',
    '\u0C02': 'n', '\u0C01': 'n', '\u0C03': 'h',
    '\u0C4D': '',
};

// ── Kannada (basic) ──
const KANNADA_MAP: Record<string, string> = {
    '\u0C85': 'a', '\u0C86': 'aa', '\u0C87': 'i', '\u0C88': 'ee', '\u0C89': 'u', '\u0C8A': 'oo',
    '\u0C8E': 'e', '\u0C8F': 'ee', '\u0C90': 'ai', '\u0C92': 'o', '\u0C93': 'oo', '\u0C94': 'au',
    '\u0C95': 'ka', '\u0C96': 'kha', '\u0C97': 'ga', '\u0C98': 'gha', '\u0C99': 'nga',
    '\u0C9A': 'cha', '\u0C9B': 'chha', '\u0C9C': 'ja', '\u0C9D': 'jha', '\u0C9E': 'nya',
    '\u0C9F': 'ta', '\u0CA0': 'tha', '\u0CA1': 'da', '\u0CA2': 'dha', '\u0CA3': 'na',
    '\u0CA4': 'ta', '\u0CA5': 'tha', '\u0CA6': 'da', '\u0CA7': 'dha', '\u0CA8': 'na',
    '\u0CAA': 'pa', '\u0CAB': 'pha', '\u0CAC': 'ba', '\u0CAD': 'bha', '\u0CAE': 'ma',
    '\u0CAF': 'ya', '\u0CB0': 'ra', '\u0CB2': 'la', '\u0CB5': 'va',
    '\u0CB6': 'sha', '\u0CB7': 'sha', '\u0CB8': 'sa', '\u0CB9': 'ha',
    '\u0CBE': 'aa', '\u0CBF': 'i', '\u0CC0': 'ee', '\u0CC1': 'u', '\u0CC2': 'oo',
    '\u0CC6': 'e', '\u0CC7': 'ee', '\u0CC8': 'ai', '\u0CCA': 'o', '\u0CCB': 'oo', '\u0CCC': 'au',
    '\u0C82': 'n', '\u0C83': 'h',
    '\u0CCD': '',
};

// Combined master map for all Indic scripts
const INDIC_MAP: Record<string, string> = {
    ...DEVANAGARI_MAP,
    ...GURMUKHI_MAP,
    ...BENGALI_MAP,
    ...TAMIL_MAP,
    ...TELUGU_MAP,
    ...KANNADA_MAP,
};

// Regex to detect any Indic script character
const INDIC_RE = /[\u0900-\u0D7F]/;

function transliterateIndic(text: string): string {
    if (!INDIC_RE.test(text)) return text;

    let result = '';
    const chars = [...text];
    for (let i = 0; i < chars.length; i++) {
        const ch = chars[i];
        // Try two-char combo first (for nukta variants)
        if (i + 1 < chars.length) {
            const combo = ch + chars[i + 1];
            if (INDIC_MAP[combo] !== undefined) {
                result += INDIC_MAP[combo];
                i++;
                continue;
            }
        }
        if (INDIC_MAP[ch] !== undefined) {
            result += INDIC_MAP[ch];
        } else {
            result += ch;
        }
    }
    return result;
}

/**
 * Final safety: strip any character that isn't a basic Latin letter, digit, or space.
 * This ensures only keyboard-typeable characters remain.
 */
function stripNonLatin(text: string): string {
    return text.replace(/[^a-z0-9 ]/g, '');
}

export function cleanLine(line: string): string {
    let cleaned = line.toLowerCase();
    cleaned = transliterateIndic(cleaned);
    cleaned = cleaned
        .replace(PUNCTUATION_RE, '')
        .replace(/\s+/g, ' ')
        .trim();
    // Final cleanup: remove any surviving non-Latin characters
    cleaned = stripNonLatin(cleaned);
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
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
