# ComfyUI + FLUX 2 Setup for GatesAI Chat

This guide gets local image generation working end-to-end in the GatesAI Chat
desktop app using [ComfyUI](https://github.com/comfyanonymous/ComfyUI) as the
backend and [FLUX 2-dev](https://huggingface.co/Comfy-Org/flux2-dev) as the
model. After setup the app's `image_generate` tool will route to your local
GPU through ComfyUI. The foundation build does not include cloud fallback or
AUTOMATIC1111 routing.

Audience: another human, or an automated agent (Claude Code, Cursor, etc.)
running on the target machine.

---

## 0. Requirements

- **OS:** Windows 10/11 (Linux/macOS also work; paths differ)
- **GPU:** NVIDIA, 12 GB+ VRAM recommended (16 GB fits FLUX 2 fp8 mixed comfortably)
- **Disk:** ~60 GB free (model files) + 10 GB for ComfyUI itself
- **Network:** stable connection; the diffusion model alone is ~33 GB
- **Python:** not required — ComfyUI's Windows portable ships its own runtime

Verify GPU:

```powershell
nvidia-smi
```

If this fails, install the latest NVIDIA driver before continuing.

---

## 1. Install ComfyUI (portable)

1. Download the latest Windows portable release (7z):
   https://github.com/comfyanonymous/ComfyUI/releases
   Look for `ComfyUI_windows_portable_nvidia.7z`.

2. Extract with 7-Zip to a folder with ~60 GB free. Recommended location:

   ```
   C:\Users\<YOU>\ComfyUI\ComfyUI_windows_portable\
   ```

   (Any path works; remember it — you'll need it in step 3.)

3. Quick sanity check (no models yet — just verifies it boots):

   ```powershell
   cd "C:\Users\<YOU>\ComfyUI\ComfyUI_windows_portable"
   .\run_nvidia_gpu.bat
   ```

   When you see `Starting server` and `To see the GUI go to: http://127.0.0.1:8188`
   it's working. Close the window (Ctrl+C) before moving on.

---

## 2. Download FLUX 2-dev model files (~56 GB total)

Place each file in the exact subfolder shown. Create subfolders if they don't exist.

**Base folder:** `...\ComfyUI_windows_portable\ComfyUI\models\`

| # | File | Size | Destination | URL |
|---|------|------|-------------|-----|
| 1 | `flux2_dev_fp8mixed.safetensors` | ~33 GB | `diffusion_models\` | https://huggingface.co/Comfy-Org/flux2-dev/resolve/main/split_files/diffusion_models/flux2_dev_fp8mixed.safetensors |
| 2 | `mistral_3_small_flux2_fp8.safetensors` | ~16.8 GB | `text_encoders\` | https://huggingface.co/Comfy-Org/flux2-dev/resolve/main/split_files/text_encoders/mistral_3_small_flux2_fp8.safetensors |
| 3 | `flux2-vae.safetensors` | ~320 MB | `vae\` | https://huggingface.co/Comfy-Org/flux2-dev/resolve/main/split_files/vae/flux2-vae.safetensors |

### Recommended downloader: `curl` (resumable)

```powershell
$models = "C:\Users\<YOU>\ComfyUI\ComfyUI_windows_portable\ComfyUI\models"
New-Item -ItemType Directory -Force -Path "$models\diffusion_models","$models\text_encoders","$models\vae" | Out-Null

curl -L -C - -o "$models\vae\flux2-vae.safetensors" `
  "https://huggingface.co/Comfy-Org/flux2-dev/resolve/main/split_files/vae/flux2-vae.safetensors"

curl -L -C - -o "$models\text_encoders\mistral_3_small_flux2_fp8.safetensors" `
  "https://huggingface.co/Comfy-Org/flux2-dev/resolve/main/split_files/text_encoders/mistral_3_small_flux2_fp8.safetensors"

curl -L -C - -o "$models\diffusion_models\flux2_dev_fp8mixed.safetensors" `
  "https://huggingface.co/Comfy-Org/flux2-dev/resolve/main/split_files/diffusion_models/flux2_dev_fp8mixed.safetensors"
```

The `-C -` flag means "resume from wherever you left off" — essential for the
33 GB file. If the connection drops, just re-run the command.

> **Do NOT use PowerShell's `Invoke-WebRequest`** for large files. It buffers the
> entire response in memory before writing to disk and will either OOM or
> abort connections partway.

### Alternative: Hugging Face CLI (parallel chunks, most robust)

```powershell
pip install -U "huggingface_hub[cli]"
huggingface-cli download Comfy-Org/flux2-dev `
  split_files/diffusion_models/flux2_dev_fp8mixed.safetensors `
  split_files/text_encoders/mistral_3_small_flux2_fp8.safetensors `
  split_files/vae/flux2-vae.safetensors `
  --local-dir "C:\Users\<YOU>\ComfyUI\ComfyUI_windows_portable\ComfyUI\models"
```

> Note: `huggingface-cli download` preserves the repo's directory layout
> (`split_files/diffusion_models/...`). If you use this method, you'll need to
> **move** the files up one level into `models\diffusion_models\` etc., OR use
> ComfyUI's `extra_model_paths.yaml` to tell it where the nested files live.
> The `curl` method above is simpler.

### Verify downloads

```powershell
$models = "C:\Users\<YOU>\ComfyUI\ComfyUI_windows_portable\ComfyUI\models"
Get-ChildItem "$models\diffusion_models","$models\text_encoders","$models\vae" -Recurse -File |
  Select-Object FullName, @{N='GB';E={[math]::Round($_.Length/1GB,2)}}
```

Expected output (approximate):

```
   ...\diffusion_models\flux2_dev_fp8mixed.safetensors        33.02
...\text_encoders\mistral_3_small_flux2_fp8.safetensors    16.80
...\vae\flux2-vae.safetensors                               0.31
```

If any size is off by more than ~1%, the file is corrupt — delete and re-download.

---

## 3. Let GatesAI start ComfyUI

Open **GatesAI Chat -> Local -> Runtimes** and click **Auto-detect**. If the
portable folder is not found, paste the portable root path:

```text
C:\Users\<YOU>\ComfyUI\ComfyUI_windows_portable
```

Keep **Manage this process from GatesAI** enabled and click **Start** on the
ComfyUI row. GatesAI launches the bundled Python runtime, appends the required
CORS flags for the desktop WebView, captures stdout/stderr into the Local menu
logs, and stops the managed child process when the app exits.

Open that URL in a browser to confirm the UI loads. You don't need to do
anything in the web UI — GatesAI Chat talks to it via the API.

ComfyUI still serves on `http://127.0.0.1:8188`.

---

## 4. Configure GatesAI Chat

1. Launch the GatesAI Chat desktop app.
2. Open **Local**.
3. In **Local image generation**, click **Set image_generate to ComfyUI** once
   ComfyUI is online.
4. Set:
   - **Quality preset:** `Draft — SDXL Lightning 4-step` for fast prototype
     images using the built-in hi-res workflow, or `Final — custom / FLUX
     workflow` for FLUX 2.
   - **Prompt enhancement:** `Off` by default for prompt adherence. Turn it on
     only when you explicitly want the current chat model to rewrite terse
     prompts before generation.
   - **Workflow JSON path:** leave blank for the built-in final FLUX.2 Klein
     workflow, or set `/workspace/scripts/comfy-workflows/current-final-workflow.json`
     to use the checked-in template explicitly.
   - **Cloud fallback:** `fal.ai` (optional — only takes effect if you've
     added a fal.ai API key and the local backend fails)

Settings persist automatically.

---

## 5. Test it

In any chat, ask the model to generate an image:

> generate an image of a red fox sitting in a snowy pine forest at dusk

The `image_generate` tool will fire. Expected behavior:

- **First run:** 30–90 seconds (FLUX 2 has to load ~33 GB into VRAM).
- **Subsequent runs:** 5–15 seconds per image.
- **Draft preset:** usually much faster after `sdxl_lightning_4step.safetensors`
  is loaded, using the app's built-in SDXL Lightning hi-res workflow.
- The result saves to `workspace/artifacts/<timestamp>-<slug>.png`.
- A thumbnail renders inline in the chat transcript.
- Clicking the path opens the file in the OS viewer.

---

## 6. Workflow template

The app substitutes these tokens into the workflow JSON before submitting:

- `{{PROMPT}}` — user's text prompt
- `{{WIDTH}}`, `{{HEIGHT}}` — resolved from the requested aspect ratio
- `{{SEED}}` — user-provided or random

The default FLUX 2-dev workflow lives at `workspace/notes/flux2-workflow.json`.
If it's missing, recreate it with a minimal FLUX 2 node graph:

1. Open ComfyUI at http://127.0.0.1:8188
2. Load the official FLUX 2-dev example workflow (templates menu)
3. Save As → export API format → paste into `flux2-workflow.json`
4. Replace the text prompt string with `{{PROMPT}}`, width with `{{WIDTH}}`,
   height with `{{HEIGHT}}`, and the seed value with `{{SEED}}`

Any valid ComfyUI API-format workflow with those four tokens will work.

### Draft SDXL Lightning preset

For quick prototypes, place these files in ComfyUI:

```text
ComfyUI\models\checkpoints\sdxl_lightning_4step.safetensors
ComfyUI\models\checkpoints\Juggernaut_RunDiffusionPhoto2_Lightning_4Steps.safetensors
ComfyUI\models\checkpoints\RealVisXL_V4.0_Lightning.safetensors
ComfyUI\models\vae\sdxl_vae_fp16_fix.safetensors
ComfyUI\models\upscale_models\4x-UltraSharp.pth
```

Download sources:

- SDXL Lightning 4-step:
  `https://huggingface.co/ByteDance/SDXL-Lightning/resolve/main/sdxl_lightning_4step.safetensors`
- Juggernaut XL Lightning:
  `https://huggingface.co/RunDiffusion/Juggernaut-XL-Lightning`
- RealVisXL V4 Lightning:
  `https://huggingface.co/SG161222/RealVisXL_V4.0_Lightning`
- SDXL fp16-fix VAE:
  `https://huggingface.co/madebyollin/sdxl-vae-fp16-fix/resolve/main/sdxl_vae.safetensors`
- 4x-UltraSharp:
  `https://huggingface.co/lokCX/4x-Ultrasharp/resolve/main/4x-UltraSharp.pth`

Then choose **Draft — SDXL Lightning 4-step** in the Local menu. Draft is the
default ComfyUI preset, uses the app's built-in workflow, and ignores the
custom workflow path. The workflow generates at SDXL-native aspect buckets
then performs a latent 1.5x hi-res pass before saving.

---

## 7. Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Cannot connect to 127.0.0.1:8188` | ComfyUI not running | Open Local -> Runtimes and click Start on ComfyUI |
| `Error generating image: Failed to fetch` while `http://127.0.0.1:8188` opens in a browser | ComfyUI is reachable, but blocks GatesAI Chat's browser origin | Stop and restart ComfyUI from Local -> Runtimes so GatesAI adds the CORS flags |
| `Missing node type: ...` in ComfyUI log | Out-of-date ComfyUI | Update to latest release; FLUX 2 nodes require recent builds |
| `CUDA out of memory` | Model too large for VRAM | Use fp8 mixed (default here). On <12 GB VRAM, try FLUX 2 flex or drop resolution |
| `Prompt outputs failed validation` | Workflow template mismatch | Re-export workflow from ComfyUI and replace token placeholders |
| First image takes 2+ minutes | Model loading from cold disk | Normal on first run. Subsequent runs are fast |
| Connection aborted during download | ISP/HF throttling | Re-run the `curl -C -` command — it resumes |

ComfyUI logs are available from the **Logs** button in Local -> Runtimes.
Open them first when debugging generation failures.

---

## 8. For automated agents

If you're an agent (Claude Code, Cursor, etc.) executing this on behalf of a user:

1. **Do not use `Invoke-WebRequest`** to download the safetensors files. It
   will OOM or abort on the 33 GB file. Use `curl -L -C -` or `huggingface-cli`.
2. Before downloading, check if files already exist and are the expected size;
   skip re-downloading matching files.
3. Kick off the 33 GB download first (longest), then the 16 GB, then the 320 MB.
   Run them sequentially, not in parallel — HF per-IP throughput is the
   bottleneck anyway.
4. After downloads complete, use GatesAI's **Local -> Runtimes** menu to
   auto-detect and start ComfyUI. Verify the Local menu reports Online before
   reporting success.
5. Don't attempt to modify app settings programmatically — they live in app
   storage and are configured through the UI.

---

## Appendix: Alternative backends

The app also supports:

- **AUTOMATIC1111 WebUI** (`Local A1111` backend) — if you already have A1111
  running, point the app at its base URL (default `http://127.0.0.1:7860`).
  Requires a FLUX-compatible A1111 extension since stock A1111 targets SD
  models.
- **fal.ai cloud** (`fal.ai` backend) — no local GPU needed; paste an API key
  from https://fal.ai/dashboard. Best for machines without a capable GPU.

ComfyUI + FLUX 2-dev is recommended for the best local quality/cost ratio.
