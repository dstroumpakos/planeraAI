# Maia — 3D character (Blender)

`maia.py` builds Maia (chibi girl in a Planera hoodie hugging the Earth) and the
Planera office entirely from code, then renders. Headless, no add-ons needed:

```
blender -b --factory-startup --python maia.py -- <out_dir> <mode>
```

Modes: `face` (close-up check), `still` / `anim` (transparent, soft shadow),
`office_still` / `office_anim` (Planera office, 960×720, 5 s seamless loop),
`avatar` (512px transparent head-and-shoulders for the chat).

App assets made from it:
- `assets/images/atlas-office.webp` — `office_anim` frames → `ffmpeg -vf "fps=15,scale=480:360" -c:v libwebp_anim -loop 0 -quality 70`
- `assets/images/atlas-avatar.png` — `avatar.png` cropped to the head, 192×192
