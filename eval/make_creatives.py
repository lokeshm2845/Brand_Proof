"""Generates the PayNova demo logos and a labelled set of test creatives for the
Visual Compliance Engine. Run:  python eval/make_creatives.py
Every creative's expected issues are written to eval/creatives/labels.json."""
import json, os, colorsys
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "eval", "creatives")
BRAND = os.path.join(ROOT, "public", "brand")
os.makedirs(OUT, exist_ok=True)
os.makedirs(BRAND, exist_ok=True)

def font(size, bold=True):
    for f in (["C:/Windows/Fonts/arialbd.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"] if bold
              else ["C:/Windows/Fonts/arial.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]):
        if os.path.exists(f):
            return ImageFont.truetype(f, size)
    return ImageFont.load_default()

INDIGO, MIDNIGHT, AMBER, CLOUD, WHITE = "#3B2FC9", "#14172B", "#F5A524", "#F4F4FB", "#FFFFFF"

def logo_current():
    im = Image.new("RGBA", (400, 120), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([4, 4, 112, 112], radius=26, fill=INDIGO)
    d.polygon([(30, 88), (30, 30), (44, 30), (74, 70), (74, 30), (86, 30), (86, 88), (72, 88), (42, 48), (42, 88)], fill=WHITE)
    d.text((126, 26), "PayNova", font=font(60), fill=MIDNIGHT)
    return im

def logo_old():
    im = Image.new("RGBA", (400, 120), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.ellipse([6, 6, 110, 110], fill="#1E9E5A")
    d.text((22, 30), "PN", font=font(48), fill=WHITE)
    d.text((124, 34), "Pay Nova", font=font(46, bold=False), fill="#555B66")
    return im

def recolour(im, hue_shift):
    px = im.load()
    out = im.copy(); po = out.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            if a == 0: continue
            h, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
            if s > 0.3:
                r2, g2, b2 = colorsys.hls_to_rgb((h + hue_shift) % 1, l, s)
                po[x, y] = (int(r2 * 255), int(g2 * 255), int(b2 * 255), a)
    return out

cur, old = logo_current(), logo_old()
cur.save(os.path.join(BRAND, "paynova-logo.png"))
old.save(os.path.join(BRAND, "paynova-logo-old.png"))

S = 800
labels = []

def creative(name, bg, logo_img=None, logo_w=220, logo_pos=(50, 50), stretch=(1.0, 1.0),
             headline="Split bills in seconds", head_col=MIDNIGHT, head_size=64,
             body="Send money to friends with PayNova UPI.", body_col=MIDNIGHT, body_size=34, issues=()):
    im = Image.new("RGB", (S, S), bg)
    if logo_img is not None:
        w = int(logo_w * stretch[0]); h = int(logo_w * logo_img.height / logo_img.width * stretch[1])
        lg = logo_img.resize((w, h), Image.LANCZOS)
        im.paste(lg, logo_pos, lg)
    d = ImageDraw.Draw(im)
    d.text((50, 380), headline, font=font(head_size), fill=head_col)
    d.text((50, 480), body, font=font(body_size, bold=False), fill=body_col)
    im.save(os.path.join(OUT, name + ".png"))
    labels.append({"file": name + ".png", "issues": sorted(issues)})

# 1) clean
creative("clean-1", CLOUD, cur)
creative("clean-2", WHITE, cur, logo_w=300, logo_pos=(420, 60))
creative("clean-3", CLOUD, cur, logo_w=170, logo_pos=(560, 640), headline="Pay rent on time")
creative("clean-4", WHITE, cur, logo_w=260, logo_pos=(60, 620), headline="Rewards on bills")
creative("clean-5", CLOUD, cur, logo_w=200, logo_pos=(300, 60), headline="Safe and simple")
# 2) outdated logo
for i, (w, pos) in enumerate([(220, (50, 50)), (300, (420, 60)), (180, (560, 640)), (240, (60, 620))]):
    creative(f"old-logo-{i+1}", CLOUD if i % 2 == 0 else WHITE, old, logo_w=w, logo_pos=pos, issues=["LOGO_OUTDATED"])
# 3) stretched
for i, (st, pos) in enumerate([((1.5, 1.0), (50, 50)), ((1.0, 1.5), (420, 60)), ((1.45, 1.0), (60, 620)), ((1.0, 1.6), (520, 600))]):
    creative(f"stretched-{i+1}", WHITE if i % 2 == 0 else CLOUD, cur, logo_w=220, logo_pos=pos, stretch=st, issues=["LOGO_STRETCHED"])
# 4) recoloured
for i, (shift, pos) in enumerate([(0.33, (50, 50)), (0.6, (420, 60)), (0.15, (60, 620)), (0.8, (500, 620))]):
    creative(f"recoloured-{i+1}", CLOUD if i % 2 == 0 else WHITE, recolour(cur, shift), logo_w=230, logo_pos=pos, issues=["LOGO_RECOLOURED"])
# 5) low-contrast text
for i, (col, bgc) in enumerate([("#BFC0CC", WHITE), (AMBER, WHITE), ("#C9C9D6", CLOUD), ("#9DB3F0", WHITE)]):
    creative(f"low-contrast-{i+1}", bgc, cur, head_col=col, body_col=col, issues=["TEXT_CONTRAST"])
# 6) small text (good contrast)
for i, (hs, bs) in enumerate([(20, 16), (18, 15), (19, 14)]):
    creative(f"small-text-{i+1}", WHITE, cur, head_size=hs, body_size=bs, issues=["TEXT_SMALL"])
# 7) no logo
creative("no-logo-1", CLOUD, None, issues=["LOGO_MISSING"])
creative("no-logo-2", WHITE, None, headline="Festive offers", issues=["LOGO_MISSING"])

json.dump(labels, open(os.path.join(OUT, "labels.json"), "w"), indent=1)
print(len(labels), "creatives written to", OUT)
