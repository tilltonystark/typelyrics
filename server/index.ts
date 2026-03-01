import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);
const LRCLIB_BASE = 'https://lrclib.net/api';
const USER_AGENT = 'Lyritype/1.0.0 (https://lyritype.app)';

// Spotify config
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || '';
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || '';
const SPOTIFY_REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI || 'http://127.0.0.1:3001/auth/spotify/callback';

// In-memory token store (per session — for MVP)
let spotifyTokens: {
    access_token: string;
    refresh_token: string;
    expires_at: number;
} | null = null;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// ── Health ──
app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', api: 'lrclib', spotify: !!SPOTIFY_CLIENT_ID });
});

// ── LRCLIB: Search ──
app.get('/api/search', async (req, res) => {
    const q = req.query.q as string;
    if (!q) return res.status(400).json({ error: 'Missing ?q= parameter' });

    try {
        const url = `${LRCLIB_BASE}/search?q=${encodeURIComponent(q)}`;
        const response = await fetch(url, {
            headers: { 'User-Agent': USER_AGENT },
        });

        if (!response.ok) {
            return res.status(response.status).json({ error: 'LRCLIB search failed' });
        }

        const results = await response.json();
        const tracks = (results as any[]).map((r: any) => ({
            id: r.id,
            track_name: r.trackName || r.name || '',
            artist_name: r.artistName || r.artist || '',
            album_name: r.albumName || r.album || '',
            duration: r.duration || 0,
            has_synced_lyrics: !!r.syncedLyrics,
            has_plain_lyrics: !!r.plainLyrics,
        }));

        res.json({ tracks });
    } catch (err) {
        console.error('Search error:', err);
        res.status(500).json({ error: 'Search failed' });
    }
});

// ── LRCLIB: Get lyrics by ID ──
app.get('/api/lyrics/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const url = `${LRCLIB_BASE}/get/${id}`;
        const response = await fetch(url, {
            headers: { 'User-Agent': USER_AGENT },
        });

        if (!response.ok) {
            return res.status(response.status).json({ error: 'Lyrics not found' });
        }

        const data: any = await response.json();
        const syncedLyrics = data.syncedLyrics || '';
        const plainLyrics = data.plainLyrics || '';
        const hasSynced = !!syncedLyrics;

        let lines: { time: number; text: string }[] = [];

        if (hasSynced) {
            lines = syncedLyrics
                .split('\n')
                .filter((line: string) => line.trim())
                .map((line: string) => {
                    const match = line.match(/\[(\d{2}):(\d{2})\.(\d{2,3})\]\s*(.*)/);
                    if (match) {
                        const minutes = parseInt(match[1], 10);
                        const seconds = parseInt(match[2], 10);
                        const ms = parseInt(match[3].padEnd(3, '0'), 10);
                        return {
                            time: minutes * 60 + seconds + ms / 1000,
                            text: match[4].trim(),
                        };
                    }
                    return null;
                })
                .filter(Boolean);
        } else if (plainLyrics) {
            lines = plainLyrics
                .split('\n')
                .filter((line: string) => line.trim())
                .map((line: string, i: number) => ({
                    time: i * 3,
                    text: line.trim(),
                }));
        }

        res.json({
            trackId: data.id,
            trackName: data.trackName || '',
            artistName: data.artistName || '',
            duration: data.duration || 0,
            synced: hasSynced,
            lines,
            rawText: plainLyrics || syncedLyrics,
        });
    } catch (err) {
        console.error('Lyrics error:', err);
        res.status(500).json({ error: 'Lyrics fetch failed' });
    }
});

// ═══════════════════════════════════════════
// SPOTIFY OAUTH + API
// ═══════════════════════════════════════════

// ── Spotify: Start OAuth ──
app.get('/auth/spotify', (_req, res) => {
    if (!SPOTIFY_CLIENT_ID) {
        return res.status(500).json({ error: 'SPOTIFY_CLIENT_ID not configured' });
    }
    const scopes = [
        'streaming',
        'user-read-email',
        'user-read-private',
        'user-modify-playback-state',
        'user-read-playback-state',
    ].join(' ');

    const params = new URLSearchParams({
        response_type: 'code',
        client_id: SPOTIFY_CLIENT_ID,
        scope: scopes,
        redirect_uri: SPOTIFY_REDIRECT_URI,
        show_dialog: 'true',
    });

    res.redirect(`https://accounts.spotify.com/authorize?${params}`);
});

// ── Spotify: OAuth callback ──
app.get('/auth/spotify/callback', async (req, res) => {
    const code = req.query.code as string;
    if (!code) return res.status(400).json({ error: 'No code provided' });

    try {
        const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': 'Basic ' + Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64'),
            },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                code,
                redirect_uri: SPOTIFY_REDIRECT_URI,
            }),
        });

        if (!tokenRes.ok) {
            const err = await tokenRes.text();
            console.error('Token exchange failed:', err);
            return res.status(400).json({ error: 'Token exchange failed' });
        }

        const tokens = await tokenRes.json() as any;
        spotifyTokens = {
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            expires_at: Date.now() + (tokens.expires_in * 1000),
        };

        // Redirect back to app
        res.redirect('http://127.0.0.1:5173');
    } catch (err) {
        console.error('Spotify callback error:', err);
        res.status(500).json({ error: 'Callback failed' });
    }
});

// ── Spotify: Get current token (refresh if needed) ──
app.get('/auth/spotify/token', async (_req, res) => {
    if (!spotifyTokens) {
        return res.status(401).json({ error: 'Not connected to Spotify' });
    }

    // Refresh if expired (with 60s buffer)
    if (Date.now() > spotifyTokens.expires_at - 60000) {
        try {
            const refreshRes = await fetch('https://accounts.spotify.com/api/token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Authorization': 'Basic ' + Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64'),
                },
                body: new URLSearchParams({
                    grant_type: 'refresh_token',
                    refresh_token: spotifyTokens.refresh_token,
                }),
            });

            if (refreshRes.ok) {
                const data = await refreshRes.json() as any;
                spotifyTokens.access_token = data.access_token;
                spotifyTokens.expires_at = Date.now() + (data.expires_in * 1000);
                if (data.refresh_token) spotifyTokens.refresh_token = data.refresh_token;
            }
        } catch (err) {
            console.error('Token refresh failed:', err);
        }
    }

    res.json({ access_token: spotifyTokens.access_token });
});

// ── Spotify: Search for a track ──
app.get('/api/spotify/search', async (req, res) => {
    const q = req.query.q as string;
    if (!q) return res.status(400).json({ error: 'Missing ?q= parameter' });
    if (!spotifyTokens) return res.status(401).json({ error: 'Not connected to Spotify' });

    try {
        const searchRes = await fetch(
            `https://api.spotify.com/v1/search?q=${encodeURIComponent(q)}&type=track&limit=1`,
            {
                headers: { 'Authorization': `Bearer ${spotifyTokens.access_token}` },
            }
        );

        if (searchRes.ok) {
            const data = await searchRes.json() as any;
            const track = data.tracks?.items?.[0];
            if (track) {
                return res.json({
                    uri: track.uri,
                    name: track.name,
                    artist: track.artists[0]?.name,
                    albumArt: track.album.images[0]?.url,
                });
            }
        }
        res.json({ uri: null });
    } catch (err) {
        console.error('Spotify search error:', err);
        res.status(500).json({ error: 'Spotify search failed' });
    }
});

// ── Spotify: Disconnect ──
app.post('/auth/spotify/disconnect', (_req, res) => {
    spotifyTokens = null;
    res.json({ ok: true });
});

// ── Start ──
app.listen(PORT, () => {
    console.log(`🎹 Lyritype server running on http://localhost:${PORT}`);
    console.log(`   Using LRCLIB API — no API key required`);
    if (SPOTIFY_CLIENT_ID) {
        console.log(`   Spotify integration enabled`);
    } else {
        console.log(`   Spotify: not configured (set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in .env)`);
    }
});
