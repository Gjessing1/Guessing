# CLAUDE.md - Guessing (Kahoot/Fuiz Clone)

## Project Overview
"Guessing" is a self-hosted, real-time multiplayer quiz platform designed for internal teams.
- **Players:** Join via PIN or QR scan. No login required.
- **Host:** Controls game flow, displays questions and leaderboards.
- **Admin:** Manages quizzes via a password-protected editor.
- **Repo:** https://github.com/Gjessing1/Guessing
- **Live:** https://guessing.gjessing.io

## Tech Stack
- **Backend:** Node.js, Express, Socket.IO, qrcode (npm)
- **Frontend:** Vanilla JS, Tailwind CSS (CDN)
- **Deployment:** Docker, GHCR (`ghcr.io/gjessing1/guessing:latest`), Caddy (Reverse Proxy)

## Project Structure
```
/server
  app.js              Express + Socket.IO setup
  socket.js           All socket event handlers
  routes/index.js     HTTP routes (rooms, quizzes, upload, admin auth)
  game/roomManager.js In-memory room + scoring logic
  quiz/quizStore.js   File-based quiz persistence (JSON)
/client
  player/             Player view (PIN entry → avatar → lobby → game)
  host/               Host view (lobby with QR/PIN → game flow)
  admin/              Admin quiz editor (CRUD, image upload, import/export)
/public/assets
  music/              .mp3 files served statically
  images/             Uploaded question images (volume-mounted in prod)
/data
  quizzes.json        Quiz store (volume-mounted in prod)
```

## Deployment (Production)
- **Server docker-compose:** `/home/gjessing/docker/guessing/docker-compose.yml`
- **Data volumes:**
  - `/mnt/data/guessing/quiz` → `/app/data` (quiz JSON)
  - `/mnt/data/guessing/images` → `/app/public/assets/images` (uploaded images)
- **Image build:** Pushing to `main` triggers GHCR build via GitHub Actions
- **Deploy:** `docker compose pull && docker compose up -d`

## Core Features (Implemented)

### Game Flow
1. Host opens `/host` → room created → PIN + QR code shown
2. Host selects a quiz from the card list, waits for players
3. Players open `/player` (or scan QR) → PIN auto-fills → pick nickname + avatar
4. Host starts game → questions advance automatically at timer 0
5. Timer turns red + tick-tock sound at 5s remaining
6. Results shown per question with answer bar chart and mini-leaderboard
7. Final podium with scores

### Scoring
- Base: 500 pts per correct answer
- Time bonus: up to 500 pts (decays linearly over question duration)

### Avatars
- 20 emoji options + 8 background colors, randomly pre-selected on load
- Players can change name/avatar from the lobby screen without losing score

### Audio (Host only)
- Lobby loop: plays while waiting for players
- Game-start sting: plays on each new question
- Tick-tock: triggers at 5 seconds remaining
- Applause: plays on results reveal and final podium
- Player only: submit confirmation sound on answer tap

### QR Code
- Generated server-side (no CDN dependency)
- URL includes PIN: `/player?pin=XXXXXX` — scanning skips manual entry

### Admin Editor (`/admin`)
- Password gate via `ADMIN_PASSWORD` env var (open if unset)
- CRUD quizzes: title, questions, options, correct answer, time limit, optional image
- Image upload (max 5MB) persisted to volume-mounted path
- Export quiz as JSON download; import JSON file

### Reactions
- Players tap emoji buttons (👍❤️😂😮🔥) during lobby/answered/result screens
- Emojis float up the host screen in real-time

## Socket.IO Events
- **To Server:** `HOST_REGISTER`, `ROOM_JOIN`, `GAME_START` `{pin, quizId}`, `ANSWER_SUBMIT`, `NEXT_QUESTION`, `REACTION_SEND`
- **To Client:** `PLAYER_LIST_UPDATE`, `GAME_STATE_CHANGE`, `QUESTION_DATA`, `ANSWER_RESULT`, `ANSWER_COUNT`, `RESULTS_BREAKDOWN`, `REACTION_BROADCAST`, `FINAL_PODIUM`, `ERROR`

## Design Principles
- **Mobile First:** Player interface highly usable on small touchscreens with large hit zones.
- **Low Friction:** No player accounts. QR scan → avatar → playing in under 30 seconds.
- **Boring Code:** Simple, readable patterns. No complex state management libraries.
- **Self-contained:** No external runtime dependencies (QR generated server-side, audio served locally).

## Development Rules
- **Task Protocol:**
  - One task at a time.
  - Ask for approval before editing `CLAUDE.md`.
  - Provide a **Post-Task Summary** (Changes, Unchanged, Risks) after every task.
  - Wait for user confirmation before proceeding.
- **Code Style:**
  - Conventional Commits (`feat:`, `fix:`, etc.). First line < 72 characters.
  - No AI attribution in code or commits.

## Roadmap

### Phase 5: Admin Polish
- [ ] Question reordering (up/down buttons in the editor)
- [ ] Duplicate quiz button
- [ ] Question count and total time estimate shown in quiz list

### Phase 6: Question Types
- [ ] True/False question type (2 options instead of 4)
- [ ] Lightning round: no time bonus, just speed ranking
- [ ] Points multiplier per question (configurable in editor, e.g. ×1, ×2, ×3)

### Phase 7: Reliability
- [ ] Player reconnect on socket drop (rejoin same room mid-game)
- [ ] Host disconnect → grace period before ending game
- [ ] Room cleanup on idle timeout

### Phase 8: Analytics
- [ ] Save completed game results to disk (who answered what, final scores)
- [ ] Simple per-quiz analytics in admin (avg score, hardest question)
- [ ] Export results as CSV
