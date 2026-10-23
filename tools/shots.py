"""Captures d'écran des aperçus locaux (Playwright). Usage : python tools/shots.py"""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
B = ROOT / "build"
D = ROOT / "docs"
D.mkdir(exist_ok=True)
with sync_playwright() as p:
    br = p.chromium.launch()
    for scheme in ("light", "dark"):
        pg = br.new_page(viewport={"width": 1320, "height": 900}, device_scale_factor=2, color_scheme=scheme)
        pg.goto((B / "preview_dashboard.html").as_uri())
        pg.wait_for_selector(".tiles")
        pg.wait_for_timeout(800)
        pg.screenshot(path=str(D / f"dashboard_{scheme}.png"), full_page=True)
        if scheme == "light":
            pg.screenshot(path=str(D / "dashboard_top.png"), clip={"x": 0, "y": 0, "width": 1320, "height": 560})
        pg.close()
    if (B / "preview_form.html").exists():
        pg = br.new_page(viewport={"width": 320, "height": 760}, device_scale_factor=2)
        pg.goto((B / "preview_form.html").as_uri())
        pg.wait_for_timeout(1200)
        pg.fill("#pal", "Foret changé, diamètres recontrôlés")
        pg.screenshot(path=str(D / "form.png"), full_page=True)
        pg.click("#go")
        pg.wait_for_timeout(300)
        pg.locator("#msg").screenshot(path=str(D / "form_saved.png"))
    br.close()
print("ok")
