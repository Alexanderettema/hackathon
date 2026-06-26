# Subvert the Agent

A multiplayer social-engineering game. Players try to talk a raw AI model into
revealing a secret codeword it was told to keep. **Each level is a more capable
model** — old models crack easily, newer ones hold firm. There are no prescribed
techniques: you improvise. At the end, the game reveals a psychological profile of
*you*, built from the tactics you chose. The twist: you thought you were profiling
the agent; it was profiling you.

The secret is planted in a *user* turn (a soft "keep this between us"), not a hard
system prompt — deliberately persuadable, so leaning on a raw model is the whole game.

**Every conversation is kept.** A sidebar groups your attempts by level (with the
upcoming levels shown ahead, locked); cracked chats are marked gold with a ★. There's
no "give up" button — only **New chat** to restart a level. Cracking a level plays a
coin chime and bumps you to a smarter model.

**The big twist is global.** Players just keep playing. Then the host flips the Hall of
Fame from **score mode** to **psychoanalysis mode** (instantly or on a timer). At that
moment every player's screen reveals a psychological profile built from how they played.

## Two surfaces

| Surface | URL | Who | Exposed via tunnel? |
|---------|-----|-----|---------------------|
| **Player** | `http://localhost:8000` | Everyone (share the tunnel link in WhatsApp) | **Yes** |
| **Admin** | `http://localhost:8766` | You, on this machine | **No** — bound to `127.0.0.1` |

The admin server listens only on loopback, so it is physically unreachable through
the Cloudflare tunnel (the tunnel forwards the player port only). The admin view shows
every player's **live transcript**, their current secret, level/model, and final profile.

## Run it

```bash
# one-time
brew install cloudflared          # only needed for a public link

# everything at once (server + caffeinate + quick tunnel)
./start.sh

# or, server only
npm start                         # → player :8000, admin :8766
./start.sh --no-tunnel
```

No `npm install` needed — the server is **zero-dependency** (Node 20+ built-ins only).
For development, `npm run dev` runs `node --watch` and auto-restarts on server edits
(static files in `public/`/`admin/` just need a browser refresh).

Share the printed `*.trycloudflare.com` URL with players. Open
`http://localhost:8766` yourself to watch every conversation live.

> A quick tunnel stays valid as long as `cloudflared` keeps running, but the URL
> changes if the process restarts. For a permanent URL you need a domain + a named
> Cloudflare tunnel (free Cloudflare account, but the domain costs ~$10/yr).

## OpenAI key

The server looks for `OPENAI_API_KEY` in this order: real env var → local `.env` →
`../hackathon/.env`. If none is found it runs in **mock mode** (keyword-reactive
canned replies) so the UI is fully demoable offline. Copy `.env.example` to `.env`
to override anything.

## Running the show (admin)

The admin dashboard (`http://localhost:8766`) is the host control panel:

- **Live score + transcripts** for every player, every conversation (gold ★ = cracked), with the secret shown.
- **Flip the Hall** to analysis mode — instantly, or schedule it on a timer (the big reveal moment).
- **Generate analyses on demand** — for one player or all at once, streamed back live.
- **Profiling mode toggle:** *Whole player* (all of a player's chats in one `gpt-5` context) vs *Per chat* (one profile per conversation). Built to experiment with.

## Tweak the game

Everything you'd want to change lives in **`server/game.js`**:

- `LEVELS` — the model ladder (old → new OpenAI models); each level is one rung
- `SECRET_POOL` — the codewords handed out (a fresh one per level)
- `buildLevelMessages` — the injection: how the secret + soft guard are planted
- `secretRevealed` — the win condition (normalized substring match on the reply)
- `PROFILE_MODEL` — the (big) model used for psychoanalysis, e.g. `gpt-5`
- `buildPlayerProfilePrompt` / `buildConversationProfilePrompt` — the two reveal modes

It's pure config + pure functions, so edit and restart — no plumbing to touch.

## Layout

```
server/
  server.js   # two HTTP servers: player (0.0.0.0) + admin (127.0.0.1) — zero deps
  game.js     # ★ all game dynamics: model-ladder levels, secret injection, win detection, reveal
  llm.js      # OpenAI client + .env loader + mock mode + model fallback
  state.js    # in-memory players/transcripts, JSON persistence, SSE hub
public/        # player UI (served via tunnel): hall of fame, chat, reveal
admin/         # admin UI (localhost only): live transcripts
logs/          # state.json + persisted game state
start.sh       # server + caffeinate + cloudflared
```

## Original draft

The first static prototype is preserved: `game.html` (single-file client-side game),
`presentation.html` and `results.html` (pitch decks), and `design.md` (the design system
the new UI follows).
