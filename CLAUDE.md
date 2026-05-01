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
  - One phase at a time.
  - Ask for approval before editing `CLAUDE.md` unless you are updating the roadmap progress which you can always freely edit as you finish tasks.
  - Provide a **Post-Task Summary** (Changes, Unchanged, Risks) after every task.
  - Wait for user confirmation before proceeding.
- **Code Style:**
  - Conventional Commits (`feat:`, `fix:`, etc.). First line < 72 characters.
  - No AI attribution in code or commits.

## Roadmap

### Phase 13: Power Features ✅
- [x] Team mode — players choose a team colour at avatar screen; team ring shown in host lobby; team leaderboard on final podium
- [x] Question time-per-question stats in game results (average answer time shown in admin results detail)
- [x] Admin: preview a quiz before going live — full-screen walkthrough with correct answer highlighted, arrow-key navigation
- [x] Sound effects pack toggle — Default / Silent / Party (party: 10 s tick-tock, confetti on every result)

## Phase 14: improvements and stability
- [x] When all players have answerd the timer should go to 0 instead of waiting the full time
- [x] Text response questions should be option to choose in quiz editor if should show player name when submitted, default is yes
- [x] Drop the pin question submitted without dropping a pin, you should place it and maybe add an actual submit button after placement?
- [x] Explain clearly what lightning round is when creating the lightning round question.
- [x] True false should be able to have other naming options, but keep true false as default.
- [x] Host menu should have small text explaining the sound modes, showing only the explanation of the one currently active and what it does. Silent is self explainatory
- [x] If host disable team mode it should dissapear from the the player screen as an option to pick team.
- [x] Default sound mode should also have cheering on final scoreboard and confetti.

- [x] Lightning Round (sometimes tied to fast-paced game modes like “Double Points” or rapid-fire questions) is basically a segment where speed matters even more than usual. This is not correctly implemented, fix it and also fix the explanation modal in admin editor. Also make a screen flash with lightning round 1,5x or 2x speed points amplifier before the question, this makes sure everyone understands the mechanics.
- [x] Light mode and dark mode if not already implemented (selectable only by host)
- [x] Make sure drop the pin has required a image for the question when editing the quiz, only the image will show for the players and they can only place the pin within the image, small confirmation box beneath image to make sure they dont accidently place and submit.
- [x] Drop-pin timer fix — questions were saved with timeLimit 0, causing host to fire results after 1 s. Fixed admin editor to show/save a real timer (default 30 s) and added server fallback for existing quizzes.
- [x] Lightning intro extended from 2 s to 3.5 s.

## Phase 15: New question types + polish

### Proposed new question type: Estimation
- [ ] **Estimation question** — host sets a numeric target (e.g. year, population, distance). Players drag a slider or type a number. Closest answer wins. Scoring by proximity (full points for exact, decaying to 0 at a configurable ±threshold). Great for data/history/geography trivia. Requires: new type `estimation` in admin editor, slider UI on player screen, proximity-scoring in roomManager.

### Proposed new question type: Image Answer
- [ ] **Image options question** — Instead of 4 text answers, each option is an image (uploaded in admin). Player taps the correct image. Same scoring as multiple-choice. Requires: 4 image upload slots in admin, image grid on player screen.

### Polish & engagement
- [ ] **Streak bonus** — 3+ consecutive correct answers awards a small bonus (e.g. +100 pts, shown with a 🔥 banner). Makes staying focused the whole game rewarding.
- [ ] **"Fastest correct" callout** — On the results screen, show which player answered correctly first (name + emoji). Already have answerTimes on the server, just need to surface it.
- [ ] **Final podium score breakdown** — On the podium screen, players can see their own question-by-question history (✅/❌ per question, total score). Gives a sense of where they gained/lost points.
- [ ] **Admin: duplicate question** — One-click copy of an existing question card. Useful for creating similar questions without re-filling every field.
- [ ] **Admin: drag-to-reorder questions** — Replace the current up/down buttons with drag handles (HTML5 drag-and-drop or a touch-friendly library).

### Known issues to fix
- [ ] **Drop-pin coordinate mismatch** — Player dp-area is `flex-1` (variable height), host results uses `aspect-ratio: 16/9`. With `object-cover` both crop the image differently, so pins appear in slightly wrong positions on the host results map. Fix: constrain player dp-area to the same 16:9 ratio (with letter-boxing), so both sides treat (x, y) identically.
- [ ] **Reaction spam** — No rate-limiting on `REACTION_SEND`. A player can flood the host screen. Add a simple per-player debounce (e.g. max 1 reaction per 500 ms server-side).
- [ ] **Reconnect during results phase** — If a player reconnects while the host is on a results screen (`questionPhase === 'results'`), they get `GAME_STATE_CHANGE { status: 'playing' }` but no content — blank screen until the next question. Send a "waiting for next question" placeholder or the current results data.

