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

### Phase 5: Admin Polish ✅
- [x] Question reordering (↑↓ buttons in the editor)
- [x] Duplicate quiz button
- [x] Question count and total time estimate shown in quiz list

### Phase 6: Question Types ✅
- [x] True/False question type (2 options, pre-filled True/False)
- [x] Lightning round: flat 500 pts, no time bonus, ⚡ shown on question

### Phase 7: Reliability ✅
- [x] Player reconnect on socket drop (session token in sessionStorage)
- [x] Host disconnect → 30s grace period before ending game
- [x] Room cleanup: rooms pruned after 3 hours idle

### Phase 8: UX Improvements ✅
- [x] Player default layout: colored answer boxes fill the screen, no question text
- [x] Host lobby toggle "Show question text on player screens" (default off)
- [x] Slide question type (🖼): title + optional image, no answers, host clicks Continue
- [x] Host view mobile-responsive (stacks vertically on small screens)
- [x] Admin list and editor mobile-responsive (buttons wrap, compact headers)

### Phase 9: UI improvements ✅
- [x] Removed "Select quiz" label from host lobby
- [x] Centered "Show question text on player screens" toggle
- [x] QR code now points to `/join/:pin` (server redirect) — reliable across all browsers and QR scanners

### Phase 10: Analytics ✅
- [x] Game results saved to `data/results.json` after every completed game
- [x] Results tab in admin: history list with date, quiz name, player count
- [x] Per-game detail: final standings + per-question correct % bar chart
- [x] Export game result as CSV (standings + question stats, Excel-compatible)

### Phase 11: General improvements ✅
- [x] Player view: safe-area padding + dvh height so content never hides behind address bar, notch, or home indicator
- [x] Admin editor: "+ Add Question" moved to top; Export JSON + Save wrap to a second row on mobile so they're always on-screen; modal padding tightened on small screens
- [x] All uploaded images converted to JPEG via sharp (supports HEIC, AVIF, WebP, BMP, TIFF, SVG, HEIF); EXIF rotation auto-corrected; upload limit raised to 10 MB raw
- [x] Quiz list sortable by Newest / Oldest / Last played / A–Z (default: Newest); preference persisted in localStorage; last-played date shown on each card
- [x] Canvas confetti rains on final podium (host + player); top-3 players slide in with staggered animation on host screen (2nd → 1st → 3rd podium-block layout)
- [x] Poll question type (📊): multiple choice, no correct answer, all bars full opacity, player sees "Vote counted!"; Word Cloud (☁️): players type a word, host sees live tag cloud sized by frequency; Drop Pin (📍): players tap an image to place a pin, host sees all emoji pins overlaid on image

### Phase 12: Polish & Power Features
- [ ] Host can skip / end question early (override timer with "Skip" button alongside "Show Results")
- [ ] Player nickname sanitisation — strip HTML so a crafted nickname can't inject markup into host screen
- [ ] Team mode — players choose a team colour at avatar screen; scoring aggregated per team on leaderboard
- [ ] Question time-per-question stats in game results (average answer time, not just correct %)
- [ ] Admin: preview a quiz as host before going live (read-only dry run)
- [ ] Sound effects pack toggle — host can switch between Default, Silent, and Party modes
- [ ] Lobby music auto-stops when host clicks Start (currently there is a brief overlap)
- [ ] Share-game link in host lobby — one-tap copy of the join URL for pasting into chat
- [ ] Delete game result from the Results detail view (currently only deletable from list)
- [ ] Open-text answer type: players type a short answer, host sees all responses as a list (no auto-grading)