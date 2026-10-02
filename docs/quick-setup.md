# GatesAI Chat: Quick Setup

GatesAI runs models on your own machine first. Install the app, have Ollama
running, and you can chat with no account and no API key. Local images and
cloud models are optional extras.

Everything local lives in one place inside the app: **Settings → Models →
Local** (Settings is the gear at the foot of the sidebar). It shows what
GatesAI found and, when something is missing, the one next step.

---

## 1. Install GatesAI Chat

| Platform | Download |
| --- | --- |
| Windows 10/11 | [`GatesAI-Chat-Setup-x64.exe`](https://github.com/Calculator5329/GatesAI-Chat-releases/releases/latest/download/GatesAI-Chat-Setup-x64.exe) |
| Linux x86_64 | [`GatesAI-Chat-x86_64.AppImage`](https://github.com/Calculator5329/GatesAI-Chat-releases/releases/latest/download/GatesAI-Chat-x86_64.AppImage) |

The bridge that runs file and shell tools is bundled and starts with the app.

---

## 2. Local chat with Ollama

1. Install Ollama from [ollama.com/download](https://ollama.com/download).
   It runs in the background after install.
2. Open GatesAI. It finds Ollama at `http://127.0.0.1:11434` by itself and
   lists every model you have, labeled with what each can do (tools, images,
   thinking).
3. No models yet? The first screen offers **Get qwen3.5:4b (3.4 GB)**.
   It can call tools, read images and think step by step. From a terminal it
   is `ollama pull qwen3.5:4b`.

New chats start on a local model whenever one is installed, even if you also
have a cloud key. Turn that off with **Start new chats on a local model** in
**Settings → Models → Local**. Existing chats keep the model they were on.

If Ollama stops or starts later, GatesAI notices on its next check: right
away when you switch back to its window, otherwise within five minutes.
**Check again** on the first screen or the composer banner, or **Check now**
in Settings, checks right away. There is nothing to start or toggle by hand.

### Ollama on another machine

Use a GPU box, a home server or a hosted Ollama instead of this computer:

1. On the server, let Ollama listen beyond localhost by setting
   `OLLAMA_HOST=0.0.0.0:11434` in its environment, then restart it.
2. In GatesAI, open **Settings → Models → Local**, type the server's address
   into the Chat row in place of `http://127.0.0.1:11434`, and press Enter.
   Any of these work: `192.168.1.20`, `gpu-box:11434`, `100.80.1.2`
   (Tailscale), `https://ollama.example.com`. Port 11434 is assumed when you
   leave it out.
3. If the server sits behind a proxy that wants a bearer token, paste it into
   the API key field that appears under a server address. It is stored in
   your OS keychain.

The server must serve Ollama at the root of its address:
`https://ollama.example.com` works, `https://example.com/ollama` does not.
You do not need `OLLAMA_ORIGINS` on the server.

---

## 3. Local images with ComfyUI (optional)

1. Install [ComfyUI Desktop](https://www.comfy.org/download) (or a manual
   ComfyUI install) and start it.
2. Put one image model into it. [ComfyUI setup](comfyui-setup.md) has the two
   we recommend (a light one and a quality one), their download pages and the
   folder each goes in.
3. That's it. GatesAI finds ComfyUI on port 8188 or 8000, reads which models
   it has and picks a matching workflow. No `--enable-cors-header`, no
   workflow editing.

Then ask any chat model for a picture ("draw a glass cathedral at golden
hour"). The image appears in the chat, and the file lands in ComfyUI's
`output/gatesai/` folder. When ComfyUI is not running, image
requests fall back to OpenRouter if you have a key.

---

## Optional: memory across chats

Recall over past chats and notes uses the `nomic-embed-text` model through
Ollama. **Settings → Models → Local → Memory** shows whether it is installed; from
a terminal it is `ollama pull nomic-embed-text`.

## Optional: cloud models

Add an OpenRouter key under **Settings → Models → OpenRouter** to use cloud
models. You can switch between local and cloud in any chat.

---

## Troubleshooting

| What you see | What to do |
| --- | --- |
| Chat row says **Nothing is answering at http://127.0.0.1:11434** | Ollama is not running. Open the Ollama app or run `ollama serve`. |
| A server address stays offline | On the server, check `OLLAMA_HOST=0.0.0.0:11434` and that port 11434 is open. From this machine, `curl http://<server>:11434/api/version` should print a version. |
| Ollama is online but the model list is empty | Download a model from the Local card, or `ollama pull qwen3.5:4b`. |
| Images row says ComfyUI is online but has no usable model | Add a model as described in [ComfyUI setup](comfyui-setup.md). |
| **Bridge offline** | Close and re-open the app. Another program may be using port `7331`. |

---

## For developers: building the installer

```powershell
cd "<path-to-this-repo>"
npm install
npm run ci
npm run tauri:build
```

Artifacts:

- **Installer:** `src-tauri\target\release\bundle\nsis\GatesAI Chat_<version>_x64-setup.exe` (version in `src-tauri/tauri.conf.json`).
- **Bridge sidecar** must exist at `src-tauri\binaries\gatesai-bridge-x86_64-pc-windows-msvc.exe` before bundling.
- **Linux AppImage:** on a Linux host, build or copy the sidecar to `src-tauri/binaries/gatesai-bridge-x86_64-unknown-linux-gnu`, then run `npx tauri build --bundles appimage`. `scripts/prepare-linux-sidecar.sh` does this from `../gatesai-bridge` or from `GATESAI_BRIDGE_BIN`.

For deeper architecture, see `docs/architecture.md`.
