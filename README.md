# 🎹 Lyritype

A music-synced typing experience where your typing speed controls audio playback. Type lyrics, control the music.

## Quick Start

### 1. Backend Setup
```bash
cd server
cp .env.example .env
# Edit .env and add your MUSIXMATCH_API_KEY
npm install
npm run dev
```

### 2. Frontend Setup
```bash
# From project root
npm install
npm run dev
```

Open **http://localhost:5173** — the frontend proxies API calls to the backend on port 3001.

## Features

- **Song Search** — Search by song name via Musixmatch
- **Synced & Plain Lyrics** — Uses LRC timestamps when available, estimates otherwise
- **Two A/B Modes**:
  - ⚡ **Flow Mode** — Continuous stream (Monkeytype-style)
  - 🎤 **Lyric Mode** — Structured lines (Apple Music-style)
- **Audio Engine** — Word-level Web Audio API playback with per-word rate control (0.5x–1.75x)
- **No Drift** — Each word resets its audio anchor independently
- **MP3 Upload** — Optional local audio sync
- **Live Stats** — Rolling WPM, accuracy, tempo stability
- **Results** — Grade (S/A/B/C/D), PNG export, replay

## Architecture

```
lyritype/
├── src/
│   ├── engine/
│   │   ├── AudioEngine.ts      # Web Audio API word-level player
│   │   ├── lyricsParser.ts     # LRC parser + word timestamp estimation
│   │   └── useTypingEngine.ts  # React hook for typing state
│   ├── lib/
│   │   └── analytics.ts        # LocalStorage analytics
│   ├── screens/
│   │   ├── SearchScreen.tsx     # Song search + mode select + MP3 upload
│   │   ├── TypingScreen.tsx     # Mode A/B typing interface
│   │   └── ResultsScreen.tsx    # Session results + PNG export
│   ├── App.tsx                  # Screen router
│   ├── types.ts                 # All TypeScript interfaces
│   └── index.css                # Tailwind + design system
├── server/
│   ├── index.ts                 # Express API (Musixmatch proxy)
│   └── .env.example             # API key template
└── README.md
```

## Audio Engine — How It Works

1. User uploads MP3 → decoded into `AudioBuffer`
2. Lyrics are split into words with estimated timestamps
3. On each word completion:
   - Calculate `rate = expectedDuration / actualTypingDuration`
   - Clamp rate to `[0.5, 1.75]`
   - Create `AudioBufferSourceNode` for the next word's segment
   - Apply micro-fade GainNode (8ms) for click-free transitions
   - Start playback at the word's **absolute offset** — no cumulative drift

## Environment Variables

| Variable | Description |
|---|---|
| `MUSIXMATCH_API_KEY` | Required. Get from [developer.musixmatch.com](https://developer.musixmatch.com) |
| `PORT` | Backend port (default: 3001) |

## Deployment

**Frontend (Vercel)**:
```bash
npm run build  # outputs to dist/
```
Set the API proxy in `vercel.json` or update fetch URLs to point to your backend domain.

**Backend (Render/Railway)**:
```bash
cd server && npm run build && npm start
```
Set `MUSIXMATCH_API_KEY` in your deployment environment variables.

## Known Limitations

- Musixmatch free tier may not return synced lyrics for all tracks
- Audio sync requires user-uploaded MP3 (no streaming)
- Word-level timestamps are estimated from line-level data

## Legal

Audio files are processed locally in the browser only. No music is stored on the server.

> **Users are responsible for music file rights.**

## Next Iteration Roadmap

- [ ] Rich sync (word-level timestamps via `track.richsync.get`)
- [ ] Persistent user profiles
- [ ] PostHog/Plausible analytics integration
- [ ] Leaderboards per song
- [ ] PWA support for offline practice
