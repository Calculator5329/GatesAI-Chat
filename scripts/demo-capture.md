# Demo GIF capture script

Exact, click-by-click steps to record the README hero demo
(`docs/media/demo.gif`). The recording needs a human on a desktop machine —
everything else (this script, the README embed, the roadmap tick) is already
in the repo. Follow the beats verbatim so the loop stays inside the 20–40s
budget and shows the three things worth showing:

1. **A background agent** — the model calls `spawn_task` and keeps working.
2. **The Task center** — the right-dock panel showing that agent run with
   live progress → completion + cost.
3. **A rendered artifact** — the model calls `artifact` and an HTML artifact
   auto-opens in the dock, fully rendered.

Target: **20–40s**, silent loop, **`docs/media/demo.gif` under 10 MB**
(GitHub inlines it above the fold; keep it snappy).

---

## 0. One-time setup (before you hit record)

- **Run the desktop build**, not Web Lite — `spawn_task`, the dock, and
  artifacts are desktop-only (they need the local bridge). From this repo:
  `npm run tauri:dev`, with the Go bridge running from `../gatesai-bridge`
  (`go run ./cmd/gatesai-bridge`, or its prebuilt `bin/gatesai-bridge`).
- **Connect a reliable tool-capable model.** The new-chat default
  (Nemotron 3 Ultra **free**) is free-tier rate-limited and will stall a
  take. Open **Menu → Models → OpenRouter → Connect**, paste a key, and pick
  a fast tool-using model (any current Claude / GPT / Gemini tier is fine).
  The model **must** support tools — `spawn_task` and `artifact` are tool
  calls. Verify the model row shows a **tools** capability chip in the picker.
- **Window & theme.** Resize the window to a clean **1280×800** (matches the
  README screenshots) and pick one theme — **dark ("Obsidian") reads best**
  against the README. Menu → Settings → Theme.
- **Start clean.** Press **Ctrl+N** (New conversation) so the sidebar and
  transcript are empty; make sure the right dock is **closed** at the start
  so the reveal in Beat 2 lands.
- **Do a dry run first** with the exact prompts below so the model's phrasing
  and timing are predictable — then record the second take.

Two prompts are pre-written below. Copy them so you're not typing on camera.

---

## 1. Beat one — spawn a background agent (~0:00–0:12)

1. Click the composer and paste **Prompt A**, then press **Enter**:

   > **Prompt A:** `Spawn a background task titled "AGPL summary" that
   > writes a 3-bullet plain-English summary of the AGPL-3.0 license. While
   > it runs, tell me in one sentence what you kicked off.`

2. Let the reply stream. Two things surface: an inline activity card reading
   **"Started background task"** with a brain icon (in the ambient timeline
   under the message), and a new sidebar thread named **"Agent: AGPL
   summary"**. Then a one-line confirmation streams in.
3. Hold on the streamed sentence for ~1s — the sidebar "Agent:" thread plus
   the confirmation establish "it's still working in the background" before
   we go look at it.

## 2. Beat two — open the Task center (~0:12–0:22)

1. Press **Ctrl+K** to open the **command palette** (placeholder: "Search
   threads or actions…").
2. Type `task` and select **"Open task center"** (subtitle "Monitor
   background work in the right dock") and press **Enter**. The **right
   dock** slides open with the **Task center** panel.
3. The agent run appears under the **Running** group as a card: an **`agent`**
   kind badge, the title **"AGPL summary"**, status **In progress** with a
   **progress bar** labelled like **"Round 3 of 6"**. When it finishes it
   drops to the **History** group as **Completed** with a small **cost**
   (e.g. `$0.0012`) and a **result** count. Let the card reach **Completed**
   on camera — that state change is the payoff of this beat.

## 3. Beat three — render an artifact (~0:22–0:38)

1. Click back into the composer and paste **Prompt B**, then press **Enter**:

   > **Prompt B:** `Create an HTML artifact titled "Hello card" as a
   > complete standalone HTML document: a single centered card with a soft
   > gradient background, an <h1> that says "GatesAI Chat", and a line of
   > subtext.`

   (The `artifact` tool validates the document — it must be a full
   `<!doctype html>` page with a visible body — so ask for a *complete
   standalone HTML document*, not a fragment.)

2. The assistant calls the **`artifact`** tool; on success the **HTML
   artifact auto-opens in the dock** in its own **"HTML artifact"** panel
   (eyebrow "HTML artifact", a Source/Preview toggle, rendered in a
   sandboxed iframe) — the gradient card appears next to / in place of the
   Task center panel.
3. Rest on the rendered artifact for ~1.5s. That's the closing frame:
   chat on the left, a real rendered thing on the right.

Stop the recording. Total should land at **~30s**.

> **Loop tip:** trim so the last frame (rendered artifact) cuts cleanly back
> to the first (empty composer) — the GIF loops, so a matched start/end frame
> avoids a jarring jump.

---

## 4. Convert to GIF and hit the size budget

Record to **MP4** first (OBS, or macOS `Cmd+Shift+5`, or any screen
recorder), then convert. The two-pass `palettegen`/`paletteuse` route gives
the smallest clean GIF:

```sh
# 1. Build an optimized palette (12 fps, 960px wide — plenty for a UI loop)
ffmpeg -y -i demo.mp4 \
  -vf "fps=12,scale=960:-1:flags=lanczos,palettegen=stats_mode=diff" palette.png

# 2. Apply it
ffmpeg -y -i demo.mp4 -i palette.png \
  -lavfi "fps=12,scale=960:-1:flags=lanczos [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=3" \
  docs/media/demo.gif

# 3. Check the size — must be < 10 MB
ls -lh docs/media/demo.gif
```

**Size budget: under 10 MB** (aim for **4–7 MB**). If it's over:

- drop to `fps=10` and/or `scale=800:-1`;
- trim dead air at the head/tail (`-ss <start> -to <end>` on the input);
- keep the take closer to 20s than 40s.

`gifsicle -O3 --lossy=60 docs/media/demo.gif -o docs/media/demo.gif` squeezes
out another 20–40% if you have it installed.

---

## 5. Land it

- The file must be **`docs/media/demo.gif`** — that's the exact path the
  README already references (create the `docs/media/` directory if it doesn't
  exist yet).
- Preview `README.md` on GitHub (or a Markdown preview) to confirm the GIF
  renders above the fold and the alt text is present.
- Update `docs/roadmap.md`: the "Demo GIF at the top of the README" item is
  ticked with a "capture pending owner hands" note — replace that note with
  the ship date once the GIF is committed.
