"""Bake original convenience-store and coffee-shop branding onto exterior signs."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parents[1]
out = root / 'public/textures/neighborhood'
out.mkdir(parents=True, exist_ok=True)
font = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
bold = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
for name, label, subtitle, accent, second in [
    ('mart-sign', 'CAPY MART', '24H  ·  COFFEE  ·  FRESH FOOD', '#087862', '#258db4'),
    ('coffee-sign', 'MORI COFFEE', 'SPECIALTY COFFEE  /  DAILY BAKERY', '#44382f', '#987850'),
]:
    image = Image.new('RGB', (2048, 240), '#f4f1e8')
    d = ImageDraw.Draw(image)
    d.rectangle((0, 0, 2048, 22), fill=accent)
    d.rectangle((0, 221, 2048, 239), fill=second)
    d.text((75, 28), label, font=ImageFont.truetype(bold, 112), fill=accent)
    d.text((80, 157), subtitle, font=ImageFont.truetype(font, 38), fill=accent)
    d.rounded_rectangle((1750, 51, 1983, 184), radius=15, fill=accent)
    d.text((1785, 78), '24H' if name == 'mart-sign' else 'CAFE', font=ImageFont.truetype(bold, 54), fill='#ffffff')
    image.save(out / (name + '.png'), optimize=True)
