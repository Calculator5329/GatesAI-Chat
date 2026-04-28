# GatesAI Chat — Quick Setup

Ship this file next to **`GatesAI Chat_<version>_x64-setup.exe`**. Following it end‑to‑end gets you working **local image generation** with **zero accounts and no API keys** — just the app + ComfyUI + a few model files.

> Optional bits (Ollama for local chat, cloud LLM keys) are at the bottom. Skip them if you only want pictures.

---

## 1. Install GatesAI Chat

1. Run **`GatesAI Chat_<version>_x64-setup.exe`** and complete the installer.
2. Launch **GatesAI Chat** from the Start menu.

The companion **bridge** process (`gatesai-bridge.exe`) is bundled and starts automatically. Open **Menu → Workspace** — you should see **Bridge online**. If not, close and re‑open the app.

---

## 2. Install ComfyUI (one time)

GatesAI talks to a local ComfyUI server for image generation. Use the official **portable Windows build** — no Python install required.

1. Download **ComfyUI Windows Portable** from the project's releases page (search "ComfyUI windows portable").
2. Unzip to a permanent folder, e.g. `C:\Tools\ComfyUI_windows_portable`.
3. Done. **Do not start it manually** — GatesAI will start and stop it for you.

---

## 3. Drop in the model files

GatesAI ships two preset image pipelines. You only need the files for the preset(s) you intend to use. Files go inside your ComfyUI folder.

### Quick preset (fastest) — SDXL Lightning

| File | Goes in |
| --- | --- |
| `sdxl_lightning_4step.safetensors` | `ComfyUI\models\checkpoints\` |

That's it. Quick uses an all‑in‑one checkpoint.

### Full preset (best quality) — FLUX.2 Klein

| File | Goes in |
| --- | --- |
| `flux-2-klein-4b-fp8.safetensors` | `ComfyUI\models\diffusion_models\` |
| `qwen_3_4b.safetensors` (text encoder) | `ComfyUI\models\text_encoders\` |
| `flux2-vae.safetensors` | `ComfyUI\models\vae\` |

You can grab official copies of these from the FLUX.2 Klein release on Hugging Face. Filenames must match exactly — GatesAI's built‑in workflow looks them up by name.

> The detailed checklist with download links lives in `docs/gatesai-local-image-prereqs.md` and `docs/comfyui-setup.md` if you need it.

---

## 4. Point GatesAI at ComfyUI

Inside the app:

1. Open **Menu → Local**.
2. Under **Runtimes → ComfyUI**, click **Auto‑detect** (or **Browse…** to your `ComfyUI_windows_portable` folder).
3. Leave **Manage this process from GatesAI** ON. Click **Start**. Wait for the status to read **Online** (default URL `http://127.0.0.1:8188`).
4. Under **Local image generation**:
   - Pick **Quick** (SDXL Lightning) or **Full** (FLUX.2 Klein). Set **Upscale** to `1` for plain renders or `1.5–3` for hires‑fix on **Full**.
   - **Prompt enhancement: Off** (no LLM rewrite) is the simplest path — your text goes straight to the model.
   - Click **Set image_generate to ComfyUI**.

That's the entire setup.

---

## 5. Generate your first image

You have two ways to produce images. Pick whichever fits.

**Direct image mode (no chat, no API key, fully offline):**

1. In the **header model picker**, choose **ComfyUI (direct, no chat)**.
2. Type your prompt in the composer and send. Your message is the prompt — no LLM round‑trip.

**Chat‑driven (via a chat model that can call tools):**

1. Pick any chat model (cloud or Ollama — see optional sections below).
2. Ask: *"draw a glass cathedral at golden hour"*. The model calls the `image_generate` tool; the render appears inline with progress.

Finished images also collect under **Menu → Gallery**. Files land in `ComfyUI\output\gatesai\`.

---

## Optional: Local LLM via Ollama

Want chat that runs on your machine too?

1. Install **Ollama** from `ollama.com`. Pull a model: `ollama pull llama3.1`.
2. **Menu → Local → Runtimes → Ollama**: Auto‑detect, then **Start**.
3. **Local LLMs**: leave Base URL at `http://127.0.0.1:11434`, click **Refresh** on **Catalog**.
4. Pick the Ollama model from the header and chat as usual.

For vision tools (so chat models can describe images you attach), pull a vision model (e.g. `ollama pull qwen2.5vl:7b`) and select it under **Menu → Local → Local vision**.

---

## Optional: Cloud LLMs

Add API keys under **Menu → Settings → API** (OpenRouter, OpenAI, Anthropic, Gemini, Groq). You can mix cloud chat with local ComfyUI image gen freely.

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| **Bridge offline** | Close and re-open the app. Another process may be using port `7331`. Re-poll under **Menu → Workspace**. |
| **"Add an API key…" when sending** | Either configure an API key, install Ollama, or pick **ComfyUI (direct, no chat)** for offline image-only use. |
| **`image_generate` errors** | Check that ComfyUI shows **Online** under **Menu → Local** and that **Set image_generate to ComfyUI** was clicked. Confirm the model files for your chosen preset are in the right `ComfyUI\models\...` subfolders. |
| **ComfyUI starts but renders fail with "missing checkpoint" / "missing unet"** | A model file is in the wrong folder or the filename does not match the table in step 3. |
| **Ollama models missing from picker** | Ollama running, then **Local → Local LLMs → Refresh**. |

---

## For developers — building the installer

```powershell
cd "<path-to-this-repo>"
npm install
npm run ci
npm run tauri:build
```

Artifacts:

- **Installer:** `src-tauri\target\release\bundle\nsis\GatesAI Chat_<version>_x64-setup.exe` (version in `src-tauri/tauri.conf.json`).
- **Bridge sidecar** must exist at `src-tauri\binaries\gatesai-bridge-x86_64-pc-windows-msvc.exe` before bundling.

For deeper architecture, see **`docs/tech_spec.md`** and **`docs/architecture.md`**.
