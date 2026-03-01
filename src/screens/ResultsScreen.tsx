import { motion } from 'framer-motion';
import { SessionResult, TimerOption } from '../types';
import { useEffect, useRef } from 'react';

const C = {
    bg: '#323437',
    sub: '#646669',
    text: '#d1d0c5',
    error: '#ca4754',
    accent: '#e2b714',
    card: '#2c2e31',
    border: '#3a3c3f',
};

interface ResultsScreenProps {
    result: SessionResult;
    onReplay: () => void;
    onNewSong: () => void;
    onSwitchMode: () => void;
}

function formatTimerLabel(opt: TimerOption): string {
    if (opt === 'full') return 'full song';
    if (opt === 120) return '2 min';
    return `${opt}s`;
}

export default function ResultsScreen({ result, onReplay, onNewSong, onSwitchMode }: ResultsScreenProps) {
    // Keyboard shortcuts on results screen
    const tabRef = useRef(false);
    useEffect(() => {
        const down = (e: KeyboardEvent) => {
            if (e.key === 'Tab') { e.preventDefault(); tabRef.current = true; }
            if (e.key === 'Enter' && tabRef.current) { e.preventDefault(); onReplay(); tabRef.current = false; }
        };
        const up = (e: KeyboardEvent) => { if (e.key === 'Tab') tabRef.current = false; };
        window.addEventListener('keydown', down);
        window.addEventListener('keyup', up);
        return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
    }, [onReplay]);

    return (
        <div className="min-h-screen flex flex-col items-center justify-center px-6" style={{ background: C.bg, color: C.text, fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}>
            <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
                className="w-full max-w-lg text-center"
            >
                {/* Big WPM number */}
                <motion.div
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', stiffness: 200, damping: 12, delay: 0.2 }}
                >
                    <span className="text-7xl font-bold font-mono" style={{ color: C.accent }}>{result.avgWpm}</span>
                    <span className="text-xl block mt-1" style={{ color: C.sub }}>wpm</span>
                </motion.div>

                {/* Track info */}
                <p className="text-sm mt-6" style={{ color: C.text }}>{result.trackName}</p>
                <p className="text-xs mb-8" style={{ color: C.sub }}>
                    {result.artistName} · {result.mode} · {formatTimerLabel(result.timerOption)}
                </p>

                {/* Stats grid */}
                <div className="grid grid-cols-3 gap-4 p-5 rounded mb-8" style={{ background: C.card }}>
                    <Stat label="accuracy" value={`${result.accuracy}%`} />
                    <Stat label="words" value={`${result.correctWords}/${result.totalWords}`} />
                    <Stat label="time" value={`${Math.round(result.elapsedMs / 1000)}s`} />
                </div>

                {/* Action buttons with keyboard shortcuts */}
                <div className="flex gap-3 mb-6">
                    <button onClick={onReplay}
                        className="flex-1 py-3 rounded font-medium text-sm flex flex-col items-center gap-1"
                        style={{ background: '#fff', color: '#333' }}>
                        <span>restart</span>
                        <span className="text-[10px] opacity-60">tab + enter</span>
                    </button>
                    <button onClick={onSwitchMode}
                        className="flex-1 py-3 rounded font-medium text-sm"
                        style={{ background: C.card, color: C.text }}>
                        switch mode
                    </button>
                    <button onClick={onNewSong}
                        className="flex-1 py-3 rounded font-medium text-sm"
                        style={{ background: C.card, color: C.text }}>
                        new song
                    </button>
                </div>
            </motion.div>
        </div>
    );
}

function Stat({ label, value }: { label: string; value: string }) {
    return (
        <div className="text-center py-2">
            <span className="text-xl font-mono font-bold block" style={{ color: C.text }}>{value}</span>
            <span className="text-xs" style={{ color: C.sub }}>{label}</span>
        </div>
    );
}
