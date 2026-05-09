# GatesAI Local Image Generation Prerequisites

This is the minimal setup sheet for GatesAI Chat local image generation using
ComfyUI.

The production setup uses two lanes:

- **Draft:** SDXL Lightning 4-step for quick prototypes.
- **Final:** FLUX.2 Klein 4B FP8 with single-pass 2x Ultimate SD Upscale.

The selected final workflow is:

```text
scripts/comfy-workflows/current-final-workflow.json
```

## 1. Required Software

- Windows 10/11
- NVIDIA GPU, 12 GB VRAM minimum, 16 GB recommended
- Current NVIDIA driver
- 7-Zip
- Git
- ComfyUI Windows portable NVIDIA build

Download ComfyUI portable:

```text
https://github.com/comfyanonymous/ComfyUI/releases
```

Look for:

```text
ComfyUI_windows_portable_nvidia.7z
```

Recommended install path:

```text
C:\Users\<YOU>\Downloads\ComfyUI_fresh\ComfyUI_windows_portable\ComfyUI
```

## 2. Required ComfyUI Custom Node

Install Ultimate SD Upscale:

```powershell
$comfy = "C:\Users\<YOU>\Downloads\ComfyUI_fresh\ComfyUI_windows_portable\ComfyUI"
cd "$comfy\custom_nodes"
git clone https://github.com/ssitu/ComfyUI_UltimateSDUpscale.git
```

Restart ComfyUI after cloning.

## 3. Required Model Files

Base model folder:

```powershell
$models = "C:\Users\<YOU>\Downloads\ComfyUI_fresh\ComfyUI_windows_portable\ComfyUI\models"
```

Create folders:

```powershell
New-Item -ItemType Directory -Force -Path `
  "$models\checkpoints", `
  "$models\diffusion_models", `
  "$models\text_encoders", `
  "$models\vae", `
  "$models\upscale_models" | Out-Null
```

## 4. Final Workflow Downloads

These are required for the selected final workflow.

### FLUX.2 Klein 4B FP8

Destination:

```text
ComfyUI\models\diffusion_models\flux-2-klein-4b-fp8.safetensors
```

Download:

```powershell
curl -L -C - -o "$models\diffusion_models\flux-2-klein-4b-fp8.safetensors" `
  "https://huggingface.co/black-forest-labs/FLUX.2-klein-4b-fp8/resolve/main/flux-2-klein-4b.safetensors"
```

You may need to sign in to Hugging Face and accept the model terms first.

### Qwen 3 4B Text Encoder

Destination:

```text
ComfyUI\models\text_encoders\qwen_3_4b.safetensors
```

Download:

```powershell
curl -L -C - -o "$models\text_encoders\qwen_3_4b.safetensors" `
  "https://huggingface.co/Comfy-Org/flux2-klein-4B/resolve/main/split_files/text_encoders/qwen_3_4b.safetensors"
```

### FLUX.2 VAE

Destination:

```text
ComfyUI\models\vae\flux2-vae.safetensors
```

Download:

```powershell
curl -L -C - -o "$models\vae\flux2-vae.safetensors" `
  "https://huggingface.co/Comfy-Org/flux2-klein-4B/resolve/main/split_files/vae/flux2-vae.safetensors"
```

### 4x-UltraSharp Upscaler

Destination:

```text
ComfyUI\models\upscale_models\4x-UltraSharp.pth
```

Download:

```powershell
curl -L -C - -o "$models\upscale_models\4x-UltraSharp.pth" `
  "https://huggingface.co/lokCX/4x-Ultrasharp/resolve/main/4x-UltraSharp.pth"
```

## 5. Draft Workflow Downloads

These are required for the SDXL quick prototype lane.

### SDXL Lightning 4-step

Destination:

```text
ComfyUI\models\checkpoints\sdxl_lightning_4step.safetensors
```

Download:

```powershell
curl -L -C - -o "$models\checkpoints\sdxl_lightning_4step.safetensors" `
  "https://huggingface.co/ByteDance/SDXL-Lightning/resolve/main/sdxl_lightning_4step.safetensors"
```

### SDXL fp16-fix VAE

Destination:

```text
ComfyUI\models\vae\sdxl_vae_fp16_fix.safetensors
```

Download:

```powershell
curl -L -C - -o "$models\vae\sdxl_vae_fp16_fix.safetensors" `
  "https://huggingface.co/madebyollin/sdxl-vae-fp16-fix/resolve/main/sdxl_vae.safetensors"
```

## 6. Start ComfyUI from GatesAI

You no longer need to keep a separate terminal command around. GatesAI can
start the portable ComfyUI runtime as a managed child process and appends the
required CORS flags automatically.

Open:

```text
GatesAI Chat -> Local -> Runtimes
```

Then:

1. Click **Auto-detect**.
2. If ComfyUI is not found, paste the portable root path, for example:

```text
C:\Users\<YOU>\Downloads\ComfyUI_fresh\ComfyUI_windows_portable
```

3. Keep **Manage this process from GatesAI** enabled.
4. Click **Start** on the ComfyUI row.

The Local menu status should move to **Online**. ComfyUI should be available at:

```text
http://127.0.0.1:8188
```

## 7. Configure GatesAI Chat

Open:

```text
GatesAI Chat -> Local -> Local image generation
```

Set:

```text
Quality preset: Normal - FLUX.2 Klein
Workflow template: /workspace/scripts/comfy-workflows/current-final-workflow.json
Upscale: optional ComfyUI hires-fix
```

Click **Set image_generate to ComfyUI** once ComfyUI is online.

For quick prototypes, switch:

```text
Quality preset: Draft - SDXL quick prototype
```

Draft mode ignores the workflow template path and uses the built-in SDXL
Lightning workflow.

## 8. What The AI Can Tweak

GatesAI can choose between prepared workflows, prompts, aspect ratios, and seeds.
The final ComfyUI workflow JSON itself is static at generation time — node
settings such as `tile_width`, `mask_blur`, and `seam_fix_denoise` are baked
into `current-final-workflow.json`. To re-tune them, edit the JSON directly
and reload the page.
