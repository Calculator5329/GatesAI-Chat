# Local images with ComfyUI

The GatesAI desktop app can make images on your own GPU through
[ComfyUI](https://github.com/Comfy-Org/ComfyUI). You install ComfyUI, add one
model, and start it. GatesAI finds it, reads which models it has, and picks a
workflow that fits. There is no workflow to edit and no file name to type.
Images arrive without ComfyUI's `--enable-cors-header` flag; it only turns on
the step counter while an image renders.

When ComfyUI is not running, image requests go to OpenRouter if you have a
key. The web version of GatesAI always uses OpenRouter for images.

## 1. Install ComfyUI

Pick one:

- **ComfyUI Desktop** (Windows and macOS): download it from
  [comfy.org/download](https://comfy.org/download) and run the installer. It
  asks where to keep its files; models go in the `models` folder there. It
  listens on port 8000.
- **Manual install** (any OS, including Linux): follow the install steps in
  the [ComfyUI README](https://github.com/Comfy-Org/ComfyUI). Models go in
  `ComfyUI/models`. It listens on port 8188.

## 2. Add one model

Pick the light option or the quality option. Either one is enough. Sizes are
the download sizes.

### Light: SDXL Lightning 4-step (6.9 GB)

The fast option, and the smaller download.

| File | Get it from | Put it in |
| --- | --- | --- |
| `sdxl_lightning_4step.safetensors` | [ByteDance/SDXL-Lightning](https://huggingface.co/ByteDance/SDXL-Lightning/tree/main) | `models/checkpoints` |

Optional: the SDXL fp16-fix VAE avoids washed-out or black images on some
GPUs. Download `sdxl_vae.safetensors` from
[madebyollin/sdxl-vae-fp16-fix](https://huggingface.co/madebyollin/sdxl-vae-fp16-fix/tree/main),
save it as `models/vae/sdxl_vae_fp16_fix.safetensors`. Without it, GatesAI
decodes with the VAE built into the checkpoint.

### Quality: FLUX.2 Klein 4B (12.5 GB for all three files)

Higher quality, including text inside images. It needs a ComfyUI release
with FLUX.2 support, so update ComfyUI first if yours is older.

| File | Get it from | Put it in |
| --- | --- | --- |
| `flux-2-klein-4b-fp8.safetensors` (4.1 GB) | [black-forest-labs/FLUX.2-klein-4b-fp8](https://huggingface.co/black-forest-labs/FLUX.2-klein-4b-fp8/tree/main) | `models/diffusion_models` |
| `qwen_3_4b.safetensors` (8.0 GB) | [Comfy-Org/vae-text-encorder-for-flux-klein-4b](https://huggingface.co/Comfy-Org/vae-text-encorder-for-flux-klein-4b/tree/main/split_files/text_encoders) | `models/text_encoders` |
| `flux2-vae.safetensors` (0.3 GB) | [same repo, `split_files/vae`](https://huggingface.co/Comfy-Org/vae-text-encorder-for-flux-klein-4b/tree/main/split_files/vae) | `models/vae` |

The full-precision `flux-2-klein-4b.safetensors` (7.8 GB, from
[black-forest-labs/FLUX.2-klein-4B](https://huggingface.co/black-forest-labs/FLUX.2-klein-4B/tree/main))
works in place of the fp8 file. The `klein-base` models do not; they need a
different sampler setup.

With both options installed, GatesAI uses FLUX.2 Klein for normal images and
SDXL Lightning for quick drafts.

### Other models

Any other SDXL-family checkpoint in `models/checkpoints` (SDXL and its
fine-tunes) also works. GatesAI runs it with a plain text-to-image workflow
at SDXL sizes (about one megapixel, 1024 x 1024 for a square): 25 steps at
CFG 6, or a short low-CFG schedule when the file name says Lightning, Turbo
or LCM. With several checkpoints, it prefers one with `XL` in its name, else
the first ComfyUI lists.

Single-file FLUX checkpoints are skipped, because that workflow's CFG and
negative prompt do not suit them. An SD 1.5 checkpoint can still be picked
when nothing better is installed, but it makes poor images at SDXL sizes.

Subfolders and different capitalization are fine, for example
`models/checkpoints/sdxl/SDXL_Lightning_4step.safetensors`. The rest of the
file name has to match.

## 3. Start it

Open ComfyUI Desktop, or start your manual install the way its README says
(`python main.py`). Then open GatesAI. It looks for ComfyUI on this computer
at `http://127.0.0.1:8188` and `http://127.0.0.1:8000`, and checks again on
its own while it runs.

Ask any chat for a picture, for example "draw a glass cathedral at golden
hour". The image appears in the chat, and ComfyUI keeps a copy in its
`output` folder.

## Troubleshooting

| What you see | What to do |
| --- | --- |
| `could not reach ComfyUI at http://127.0.0.1:8188` | ComfyUI is not running, or it uses a port other than 8188 or 8000. Start it on one of those. |
| `ComfyUI is running at ... but has no image model GatesAI can use` | Add a model from step 2. GatesAI reads the model list again the next time it checks. |
| `No backend can make images yet` | GatesAI found no running ComfyUI and has no OpenRouter key. Start ComfyUI (step 3), or add a key under Settings > Models. |
| Images arrive but the card shows no step progress | Step progress comes over a WebSocket, which ComfyUI only accepts from the app when started with `--enable-cors-header`. Images arrive without it. |
| You added FLUX.2 Klein but GatesAI uses another model | One of the three files is missing or named differently, or ComfyUI is too old to load the FLUX.2 text encoder. Check the names above and update ComfyUI. |
| `CUDA out of memory` in the ComfyUI window | Use the fp8 Klein file, or switch to SDXL Lightning. |
| The first image takes a minute or more | ComfyUI is loading the model from disk. Later images are faster. |
