"""Builds the downloadable demo samples in public/samples (run after eval/make_creatives.py):
  festive-ad-offbrand.png — off-palette colours, the retired logo, guarantee claims
  (paynova-flyer.pdf is printed from eval/flyer.html — see the note below)
Run: python eval/make_samples.py"""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAMPLES = os.path.join(ROOT, "public", "samples")
BRAND = os.path.join(ROOT, "public", "brand")

def font(size, bold=True):
    for f in (["C:/Windows/Fonts/arialbd.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"] if bold
              else ["C:/Windows/Fonts/arial.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]):
        if os.path.exists(f):
            return ImageFont.truetype(f, size)
    return ImageFont.load_default()

cur = Image.open(os.path.join(BRAND, "paynova-logo.png")).convert("RGBA")
old = Image.open(os.path.join(BRAND, "paynova-logo-old.png")).convert("RGBA")

def paste(im, logo, w, pos, stretch=(1, 1)):
    bb = logo.getbbox(); logo = logo.crop(bb)
    lg = logo.resize((int(w * stretch[0]), int(w * logo.height / logo.width * stretch[1])), Image.LANCZOS)
    im.paste(lg, pos, lg)

# Festive ad: lime + pink (off-palette), retired logo, risky claims
W = 1080
ad = Image.new("RGB", (W, W), "#E8F51F")
d = ImageDraw.Draw(ad)
d.rectangle([0, 700, W, W], fill="#FF2D95")
paste(ad, old, 300, (70, 50))
d.text((70, 230), "MEGA DIWALI SALE!!", font=font(92), fill="#14172B")
d.text((70, 380), "100% guaranteed cashback", font=font(62), fill="#14172B")
d.text((70, 465), "on every Paynova payment", font=font(62), fill="#14172B")
d.text((70, 580), "Trusted by 1 million users", font=font(50), fill="#14172B")
d.text((70, 790), "Hurry - last chance!", font=font(72), fill="#FFFFFF")
d.text((70, 920), "Download now", font=font(52), fill="#FFFFFF")
ad.save(os.path.join(SAMPLES, "festive-ad-offbrand.png"))

# The merchant flyer (public/samples/paynova-flyer.pdf) is printed from eval/flyer.html with a
# browser ("Save as PDF") so it keeps a real text layer: page 1 has a squashed logo, page 2 faint + tiny text.
print("samples written")
