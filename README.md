# Portfolio — ravishankarpatel.in

Personal portfolio website of **Ravishankar Patel** — ECE undergrad at Manipal Institute of Technology, Manipal.

**Live site:** [ravishankarpatel.in](https://ravishankarpatel.in)

## About

A single-page portfolio built with plain HTML, CSS, and JavaScript — no frameworks, no build step. Hosted on GitHub Pages with a custom domain.

Sections:

- **About** — background, education, and current status
- **Projects** — featured work with case studies
- **Stack** — microcontrollers (Arduino · ESP32 · 8051), PCB design in KiCad, C++/C#, Verilog
- **Journey** — timeline of milestones
- **Contact** — email and socials

## Project case studies

Detailed write-ups live in the [`projects/`](projects/) folder:

- [Automated Medicine Dispenser](projects/medicine-dispenser.html) — QR-driven dispensing system using servo control for clinics, pharmacies, and home care
- [MCAM](projects/mcam.html)
- [Advanced Trends in ECE](projects/advance-trends-ece.html)

## Structure

```
├── index.html        # main single-page site
├── projects/         # project case-study pages
├── 404.html          # custom 404 page
├── CNAME             # custom domain (ravishankarpatel.in)
├── manifest.json     # web app manifest
├── favicon.svg / favicon.png
├── robots.txt
└── sitemap.xml
```

## Running locally

No build tools needed — just open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server
```

Then visit `http://localhost:8000`.
