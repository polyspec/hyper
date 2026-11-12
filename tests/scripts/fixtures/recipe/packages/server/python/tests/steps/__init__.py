from . import csrf_steps, media_type_steps

STEPS = {
    ("csrf.json", "mask"): csrf_steps.mask,
    ("media-type.json", "essence"): media_type_steps.essence,
}
