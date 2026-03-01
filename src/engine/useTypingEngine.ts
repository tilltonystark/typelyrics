import { useState, useCallback, useRef, useEffect } from 'react';
import { WordSegment, WordState, CharState, TypingStats, TypingMode } from '../types';

interface UseTypingEngineProps {
    words: WordSegment[];
    mode: TypingMode;
    onWordComplete?: (wordIndex: number, typingDurationMs: number, correct: boolean) => void;
    onSessionComplete?: (stats: TypingStats) => void;
}

interface UseTypingEngineReturn {
    wordStates: WordState[];
    currentWordIndex: number;
    currentCharIndex: number;
    stats: TypingStats;
    isComplete: boolean;
    isStarted: boolean;
    handleKeyDown: (e: KeyboardEvent) => void;
    reset: () => void;
}

function initWordStates(words: WordSegment[]): WordState[] {
    return words.map(segment => ({
        segment,
        chars: Array(segment.word.length).fill('pending') as CharState[],
        typedChars: '',
        startedAt: null,
        completedAt: null,
        completed: false,
        correct: false,
    }));
}

export function useTypingEngine({
    words,
    mode,
    onWordComplete,
    onSessionComplete,
}: UseTypingEngineProps): UseTypingEngineReturn {
    const [wordStates, setWordStates] = useState<WordState[]>(() => initWordStates(words));
    const [currentWordIndex, setCurrentWordIndex] = useState(0);
    const [currentCharIndex, setCurrentCharIndex] = useState(0);
    const [isComplete, setIsComplete] = useState(false);
    const [isStarted, setIsStarted] = useState(false);

    const sessionStartRef = useRef<number | null>(null);
    const correctCharsRef = useRef(0);
    const totalCharsRef = useRef(0);
    const recentWordsRef = useRef<{ wpm: number; timestamp: number }[]>([]);
    const wordTimingsRef = useRef<number[]>([]);
    const wpmHistoryRef = useRef<{ time: number; wpm: number; raw: number }[]>([]);
    const historyIntervalRef = useRef<ReturnType<typeof setInterval>>();

    // Reset when words change
    useEffect(() => {
        setWordStates(initWordStates(words));
        setCurrentWordIndex(0);
        setCurrentCharIndex(0);
        setIsComplete(false);
        setIsStarted(false);
        sessionStartRef.current = null;
        correctCharsRef.current = 0;
        totalCharsRef.current = 0;
        recentWordsRef.current = [];
        wordTimingsRef.current = [];
        wpmHistoryRef.current = [];
        clearInterval(historyIntervalRef.current);
    }, [words]);

    const calculateStats = useCallback((): TypingStats => {
        const now = Date.now();
        const elapsed = sessionStartRef.current ? now - sessionStartRef.current : 0;
        const elapsedMinutes = elapsed / 60000;

        const wpm = elapsedMinutes > 0 ? (correctCharsRef.current / 5) / elapsedMinutes : 0;

        const fiveSecondsAgo = now - 5000;
        const recentWords = recentWordsRef.current.filter(w => w.timestamp >= fiveSecondsAgo);
        const rollingWpm = recentWords.length > 0
            ? recentWords.reduce((sum, w) => sum + w.wpm, 0) / recentWords.length
            : wpm;

        const accuracy = totalCharsRef.current > 0
            ? (correctCharsRef.current / totalCharsRef.current) * 100
            : 100;

        const timings = wordTimingsRef.current;
        let tempoStability = 100;
        if (timings.length > 1) {
            const mean = timings.reduce((a, b) => a + b, 0) / timings.length;
            const variance = timings.reduce((sum, t) => sum + Math.pow(t - mean, 2), 0) / timings.length;
            const stdDev = Math.sqrt(variance);
            const cv = mean > 0 ? stdDev / mean : 0;
            tempoStability = Math.max(0, Math.round((1 - Math.min(cv, 1)) * 100));
        }

        const completed = wordStates.filter(w => w.completed).length;
        const correct = wordStates.filter(w => w.correct).length;

        return {
            wpm: Math.round(wpm),
            rollingWpm: Math.round(rollingWpm),
            accuracy: Math.round(accuracy * 10) / 10,
            tempoStability,
            wordsCompleted: completed,
            totalWords: words.length,
            correctWords: correct,
            elapsedMs: elapsed,
            wpmHistory: wpmHistoryRef.current,
        };
    }, [wordStates, words.length]);

    const advanceToNextWord = useCallback((newStates: WordState[], fromWordIdx: number): WordState[] => {
        const currentWord = newStates[fromWordIdx];
        const isAllCorrect = currentWord.chars.every(c => c === 'correct');

        currentWord.completed = true;
        currentWord.completedAt = Date.now();
        currentWord.correct = isAllCorrect;

        if (!currentWord.startedAt) currentWord.startedAt = Date.now();
        const typingDuration = currentWord.completedAt - currentWord.startedAt;

        if (isAllCorrect) {
            const wordWpm = typingDuration > 0
                ? (currentWord.segment.word.length / 5) / (typingDuration / 60000)
                : 0;
            recentWordsRef.current.push({ wpm: wordWpm, timestamp: Date.now() });
            wordTimingsRef.current.push(typingDuration);
        }

        newStates[fromWordIdx] = currentWord;
        onWordComplete?.(fromWordIdx, typingDuration, isAllCorrect);

        const nextIdx = fromWordIdx + 1;
        if (nextIdx >= words.length) {
            setIsComplete(true);
            // Stop recording WPM history — session has ended
            clearInterval(historyIntervalRef.current);
            setTimeout(() => onSessionComplete?.(calculateStats()), 50);
        } else {
            setCurrentWordIndex(nextIdx);
            setCurrentCharIndex(0);
            // Set first char of next word as current
            const nextWord = { ...newStates[nextIdx] };
            const nextChars = [...nextWord.chars];
            nextChars[0] = 'current';
            nextWord.chars = nextChars;
            newStates[nextIdx] = nextWord;
        }

        return newStates;
    }, [words.length, onWordComplete, onSessionComplete, calculateStats]);

    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        if (isComplete) return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        const key = e.key;

        // Start session on first keypress
        if (!sessionStartRef.current) {
            sessionStartRef.current = Date.now();
            setIsStarted(true);
            // Start recording WPM history every second
            clearInterval(historyIntervalRef.current);
            wpmHistoryRef.current = [];
            historyIntervalRef.current = setInterval(() => {
                if (!sessionStartRef.current) return;
                const elapsed = Date.now() - sessionStartRef.current;
                const elapsedMin = elapsed / 60000;
                if (elapsedMin <= 0) return;
                const wpm = (correctCharsRef.current / 5) / elapsedMin;
                const raw = (totalCharsRef.current / 5) / elapsedMin;
                wpmHistoryRef.current.push({
                    time: Math.round(elapsed / 1000),
                    wpm: Math.round(wpm),
                    raw: Math.round(raw),
                });
            }, 1000);
        }

        setWordStates(prev => {
            const newStates = [...prev];
            const currentWord = { ...newStates[currentWordIndex] };
            const targetWord = currentWord.segment.word;

            if (key === 'Backspace') {
                if (currentCharIndex > 0) {
                    const newCharIdx = currentCharIndex - 1;
                    const newChars = [...currentWord.chars];
                    newChars[newCharIdx] = 'current';
                    for (let i = newCharIdx + 1; i < newChars.length; i++) {
                        newChars[i] = 'pending';
                    }
                    currentWord.chars = newChars;
                    currentWord.typedChars = currentWord.typedChars.slice(0, -1);
                    newStates[currentWordIndex] = currentWord;
                    setCurrentCharIndex(newCharIdx);
                }
                return newStates;
            }

            // Space — move to next word (user explicitly presses space)
            if (key === ' ') {
                // Mark any remaining chars as incorrect
                const newChars = [...currentWord.chars];
                for (let i = currentCharIndex; i < newChars.length; i++) {
                    if (newChars[i] === 'current' || newChars[i] === 'pending') {
                        newChars[i] = 'incorrect';
                        totalCharsRef.current++;
                    }
                }
                currentWord.chars = newChars;
                newStates[currentWordIndex] = currentWord;
                return advanceToNextWord(newStates, currentWordIndex);
            }

            // Regular character
            if (key.length === 1 && currentCharIndex < targetWord.length) {
                if (!currentWord.startedAt) {
                    currentWord.startedAt = Date.now();
                }

                const newChars = [...currentWord.chars];
                const isCorrect = key === targetWord[currentCharIndex];

                totalCharsRef.current++;
                if (isCorrect) correctCharsRef.current++;

                newChars[currentCharIndex] = isCorrect ? 'correct' : 'incorrect';
                currentWord.typedChars += key;

                const nextCharIdx = currentCharIndex + 1;

                if (nextCharIdx < targetWord.length) {
                    // More chars — set next as current
                    newChars[nextCharIdx] = 'current';
                    setCurrentCharIndex(nextCharIdx);
                } else {
                    // All chars typed — wait for space to advance
                    // Don't auto-advance, cursor stays at end of word
                    setCurrentCharIndex(nextCharIdx);
                }

                currentWord.chars = newChars;
                newStates[currentWordIndex] = currentWord;
                return newStates;
            }

            return prev;
        });
    }, [currentWordIndex, currentCharIndex, isComplete, advanceToNextWord]);

    const reset = useCallback(() => {
        setWordStates(initWordStates(words));
        setCurrentWordIndex(0);
        setCurrentCharIndex(0);
        setIsComplete(false);
        setIsStarted(false);
        sessionStartRef.current = null;
        correctCharsRef.current = 0;
        totalCharsRef.current = 0;
        recentWordsRef.current = [];
        wordTimingsRef.current = [];
        wpmHistoryRef.current = [];
        clearInterval(historyIntervalRef.current);
    }, [words]);

    return {
        wordStates,
        currentWordIndex,
        currentCharIndex,
        stats: calculateStats(),
        isComplete,
        isStarted,
        handleKeyDown,
        reset,
    };
}
