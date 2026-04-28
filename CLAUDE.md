# CLAUDE.md - Guessing (Kahoot/Fuiz Clone)

## Project Overview
"Guessing" is a self-hosted, real-time multiplayer quiz platform designed for internal teams.
- **Players:** Join via PIN + Nickname (No login required).
- **Host:** Controls game flow, displays questions and leaderboards.
- **Admin:** Manages quizzes via a protected editor.
- **Repo:** https://github.com/Gjessing1/Guessing

## Tech Stack
- **Backend:** Node.js, Express, Socket.IO
- **Frontend:** Vanilla JS, Tailwind CSS (CDN)
- **Deployment:** Docker, GHCR, Caddy (Reverse Proxy)

## Project Structure
- `/server`: Express app and Socket.IO logic
- `/client`: Frontend application (Player, Host, and Admin views)
- `/public/assets`: Music (.mp3) and Static images
- `/data`: Persistent storage (JSON/SQLite)

## Core Features
- **Avatars:** Players pick an Emoji and a Background Color upon joining.
- **Soundscape:** 
  - Lobby Loop (waiting for players)
  - Question Loop (tension-building timer)
  - Result Stingers (Correct/Incorrect/Podium)
- **Ease of Entry:** Host screen displays a large PIN and a generated QR Code for mobile scanning.
- **Auth:** Admin access protected by `ADMIN_PASSWORD` env var.

## Socket.IO Events
- **To Server:** `ROOM_JOIN`, `GAME_START`, `ANSWER_SUBMIT`, `NEXT_QUESTION`, `REACTION_SEND`
- **To Client:** `PLAYER_LIST_UPDATE`, `GAME_STATE_CHANGE`, `QUESTION_DATA`, `RESULTS_BREAKDOWN`, `PLAY_SOUND`, `FINAL_PODIUM`

## Design Principles
- **Mobile First:** Player interface must be highly usable on small touchscreens with large "hit zones" for answers.
- **Low Friction:** No player accounts. Max 3 clicks to join a game.
- **Boring Code:** Simple, readable patterns. Avoid complex state management libraries.

## Development Rules
- **Task Protocol:**
  - One task at a time.
  - Ask for approval before editing `CLAUDE.md` or `GEMINI.md`.
  - Provide a **Post-Task Summary** (Changes, Unchanged, Risks) after every task.
  - Wait for user confirmation before proceeding.
- **Code Style:**
  - Use Conventional Commits (`feat:`, `fix:`, etc.).
  - No AI attribution in code or commits.
  - First line of commit message < 72 characters.

## Roadmap
### Phase 1: MVP Game Loop
- [x] Socket.IO server with room logic and Game PINs.
- [x] Player Join flow (Nickname + Emoji Avatar selection).
- [x] Host-controlled flow (Manual "Next Question").
- [x] Scoring (Base score + time-based bonus).

### Phase 2: Deployment & Auth
- [x] Dockerfile and `docker-compose`.
- [x] `ADMIN_PASSWORD` implementation for the Editor routes.
- [x] Caddy configuration for HTTPS.

### Phase 3: Music & UX
- [ ] Audio engine (Client-side triggers based on Socket events).
- [ ] QR Code generation on Host screen.
- [ ] Real-time "Reactions" (Players can tap emojis to fly up the host screen).

### Phase 4: Persistent Admin
- [ ] Quiz Editor UI (CRUD quizzes).
- [ ] Image upload support for questions.
- [ ] Import/Export quiz data (JSON).