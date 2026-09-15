"""
The report's shared design system (extracted once from the last hand-authored
report, reports/epping-forest-ledger-2026-09-03.html, plus a handful of
additive rules for the search-area map outline, the "grazing" finding
category, the app link, and the plain-English "about this report" note --
see scripts/report/render_report.py).

Editing the look of the report happens here, in one place, instead of an
LLM re-typing (and slowly drifting) a copy of the CSS every week.
"""

REPORT_CSS = """
  :root{
    --bg:#f4f4ec;
    --surface:#ffffff;
    --surface-2:#eaeedd;
    --ink:#181c11;
    --ink-soft:#52514e;
    --muted:#898781;
    --line:#ded9c6;
    --line-strong:#c9c3ac;
    --forest:#2e6b44;
    --forest-deep:#1d4a2f;
    --bark:#9c6b34;
    --forest-opacity:0.4;
    --status-good:#0ca30c;
    --status-good-ink:#0a4a0a;
    --status-warning:#fab219;
    --status-warning-ink:#6b4a00;
    --status-critical:#d03b3b;
    --status-event:#4a3aa7;
    --shadow: 0 1px 2px rgba(24,28,17,0.06), 0 8px 24px -12px rgba(24,28,17,0.18);
  }
  /* status-good, status-warning and status-critical are the same four steps in
     both themes by design (validated against both surfaces) - only the "-ink"
     text variants and the categorical --status-event hue change below. */
  @media (prefers-color-scheme: dark){
    :root:not([data-theme="light"]){
      --bg:#0e120b;
      --surface:#171b11;
      --surface-2:#1d2216;
      --ink:#edeee2;
      --ink-soft:#c3c2b3;
      --muted:#8f8d80;
      --line:#2c3121;
      --line-strong:#3a4029;
      --forest:#6fc98a;
      --forest-deep:#4fa96c;
      --bark:#d3a467;
      --forest-opacity:0.55;
      --status-good-ink:#0ca30c;
      --status-warning-ink:#fab219;
      --status-event:#9085e9;
      --shadow: 0 1px 2px rgba(0,0,0,0.4), 0 8px 24px -12px rgba(0,0,0,0.6);
    }
  }
  :root[data-theme="dark"]{
    --bg:#0e120b;
    --surface:#171b11;
    --surface-2:#1d2216;
    --ink:#edeee2;
    --ink-soft:#c3c2b3;
    --muted:#8f8d80;
    --line:#2c3121;
    --line-strong:#3a4029;
    --forest:#6fc98a;
    --forest-deep:#4fa96c;
    --bark:#d3a467;
    --forest-opacity:0.55;
    --status-good-ink:#0ca30c;
    --status-warning-ink:#fab219;
    --status-event:#9085e9;
    --shadow: 0 1px 2px rgba(0,0,0,0.4), 0 8px 24px -12px rgba(0,0,0,0.6);
  }

  *{box-sizing:border-box;}
  body{
    margin:0;
    background:var(--bg);
    color:var(--ink);
    font-family:"Public Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    line-height:1.5;
  }
  .wrap{max-width:1040px;margin:0 auto;padding:0 24px 64px;}
  a{color:var(--forest-deep);}
  .mono{font-family:"JetBrains Mono", ui-monospace, monospace; font-variant-numeric: tabular-nums;}

  header.masthead{
    background:var(--forest-deep);
    color:#f4f4ec;
    padding:40px 24px 32px;
  }
  header.masthead .inner{max-width:1040px;margin:0 auto;}
  .eyebrow{
    font-family:"Fraunces", serif;
    font-style:italic;
    font-weight:480;
    font-size:0.95rem;
    letter-spacing:0.06em;
    color:#c9dfc9;
    margin:0 0 6px;
  }
  h1.title{
    font-family:"Fraunces", serif;
    font-weight:600;
    font-size:clamp(2.1rem, 4vw, 3rem);
    letter-spacing:-0.01em;
    margin:0 0 14px;
    text-wrap:balance;
  }
  .meta-row{
    display:flex;
    flex-wrap:wrap;
    gap:10px 18px;
    align-items:center;
    font-size:0.92rem;
    color:#d8e5d3;
  }
  .meta-row .coverage{color:#b9ceb4;}
  .tag{
    display:inline-flex;
    align-items:center;
    gap:6px;
    padding:4px 10px;
    border-radius:999px;
    font-size:0.78rem;
    font-weight:600;
    letter-spacing:0.03em;
    text-transform:uppercase;
  }
  .tag.sample{
    background:rgba(250,178,25,0.18);
    color:#ffd98a;
    border:1px solid rgba(250,178,25,0.4);
  }
  .banner{
    margin-top:20px;
    padding:14px 16px;
    background:rgba(255,255,255,0.08);
    border:1px solid rgba(255,255,255,0.16);
    border-radius:10px;
    font-size:0.92rem;
    color:#e7efe2;
  }
  .banner strong{color:#fff;}

  .stat-strip{
    display:grid;
    grid-template-columns:repeat(5,1fr);
    gap:1px;
    background:var(--line);
    border:1px solid var(--line);
    border-radius:12px;
    overflow:hidden;
    margin:-28px 0 40px;
    box-shadow:var(--shadow);
    position:relative;
    z-index:2;
  }
  .stat{
    background:var(--surface);
    padding:18px 16px;
    text-align:left;
  }
  .stat .n{
    font-family:"JetBrains Mono", monospace;
    font-variant-numeric: tabular-nums;
    font-size:1.9rem;
    font-weight:600;
    line-height:1;
  }
  .stat .n.good{color:var(--status-good-ink);}
  .stat .n.critical{color:var(--status-critical);}
  .stat .n.warning{color:var(--status-warning-ink);}
  .stat .n.event{color:var(--status-event);}
  .stat .n.grazing{color:var(--bark);}
  .stat .lbl{
    margin-top:4px;
    font-size:0.78rem;
    color:var(--ink-soft);
    text-transform:uppercase;
    letter-spacing:0.04em;
  }

  section{margin:48px 0;}
  h2.section-title{
    font-family:"Fraunces", serif;
    font-weight:600;
    font-size:1.5rem;
    margin:0 0 4px;
  }
  .section-sub{color:var(--ink-soft); font-size:0.95rem; margin:0 0 20px;}

  .map-card{
    background:var(--surface);
    border:1px solid var(--line);
    border-radius:16px;
    box-shadow:var(--shadow);
    padding:20px;
    display:grid;
    grid-template-columns:minmax(0,340px) 1fr;
    gap:24px;
    align-items:start;
  }
  .map-svg-holder{
    background:var(--surface-2);
    border-radius:12px;
    border:1px solid var(--line);
    padding:10px;
  }
  .map-svg-holder svg{display:block;width:100%;height:auto;}
  .forest-fill{fill:var(--forest); opacity:var(--forest-opacity);}
  .town-dot{fill:var(--muted);}
  .town-label{
    font-family:"Public Sans", sans-serif;
    font-size:10.5px;
    fill:var(--ink-soft);
  }
  .pin-ring{stroke:var(--surface); stroke-width:2;}
  .pin-num{
    font-family:"JetBrains Mono", monospace;
    font-size:10px;
    font-weight:600;
    fill:#fff;
    text-anchor:middle;
    dominant-baseline:central;
  }
  .compass text{font-family:"Fraunces",serif; font-size:12px; fill:var(--ink-soft); font-weight:600;}
  .compass line{stroke:var(--ink-soft); stroke-width:1;}

  .legend{
    display:flex;
    flex-wrap:wrap;
    gap:10px 16px;
    margin-top:14px;
    padding-top:14px;
    border-top:1px solid var(--line);
  }
  .legend-item{display:flex;align-items:center;gap:7px;font-size:0.84rem;color:var(--ink-soft);}
  .legend-dot{width:11px;height:11px;border-radius:50%;flex:none;}

  .map-side{display:flex;flex-direction:column;gap:14px;}
  .map-side p{margin:0; color:var(--ink-soft); font-size:0.92rem;}
  .find-mini{
    display:flex;
    gap:10px;
    align-items:flex-start;
    font-size:0.88rem;
  }
  .find-mini .badge{
    flex:none;
    width:20px;height:20px;border-radius:50%;
    display:flex;align-items:center;justify-content:center;
    font-family:"JetBrains Mono",monospace;font-size:11px;font-weight:600;color:#fff;
    margin-top:1px;
  }
  .find-mini .txt strong{display:block;}
  .find-mini .txt span{color:var(--ink-soft);}

  .cards{display:flex; flex-direction:column; gap:14px;}
  .card{
    background:var(--surface);
    border:1px solid var(--line);
    border-left-width:5px;
    border-radius:10px;
    padding:16px 18px;
    box-shadow:var(--shadow);
  }
  .card.good{border-left-color:var(--status-good);}
  .card.critical{border-left-color:var(--status-critical);}
  .card.warning{border-left-color:var(--status-warning);}
  .card.event{border-left-color:var(--status-event);}
  .card-head{
    display:flex;
    align-items:center;
    gap:10px;
    margin-bottom:6px;
    flex-wrap:wrap;
  }
  .pin-chip{
    width:22px;height:22px;border-radius:50%;
    display:flex;align-items:center;justify-content:center;
    font-family:"JetBrains Mono",monospace;font-size:12px;font-weight:600;color:#fff;
    flex:none;
  }
  .pin-chip.good{background:var(--status-good);}
  .pin-chip.critical{background:var(--status-critical);}
  .pin-chip.warning{background:var(--status-warning); color:var(--status-warning-ink);}
  .pin-chip.event{background:var(--status-event);}
  .card h3{font-family:"Fraunces", serif; font-weight:600; font-size:1.12rem; margin:0;}
  .status-label{
    font-size:0.72rem;
    font-weight:700;
    letter-spacing:0.05em;
    text-transform:uppercase;
    padding:2px 8px;
    border-radius:999px;
  }
  .status-label.good{background:color-mix(in srgb, var(--status-good) 18%, transparent); color:var(--status-good-ink);}
  .status-label.critical{background:color-mix(in srgb, var(--status-critical) 16%, transparent); color:var(--status-critical);}
  .status-label.warning{background:color-mix(in srgb, var(--status-warning) 22%, transparent); color:var(--status-warning-ink);}
  .status-label.event{background:color-mix(in srgb, var(--status-event) 16%, transparent); color:var(--status-event);}
  .card p{margin:6px 0; color:var(--ink-soft); font-size:0.94rem;}
  .card .addr{font-family:"JetBrains Mono",monospace; font-size:0.82rem; color:var(--muted);}
  .card .src{font-size:0.82rem; margin-top:8px;}
  .card .flag{
    margin-top:10px;
    padding:8px 10px;
    background:var(--surface-2);
    border-radius:8px;
    font-size:0.84rem;
    color:var(--ink-soft);
  }

  .methodology{
    background:var(--surface-2);
    border-radius:12px;
    padding:22px 24px;
    border:1px solid var(--line);
  }
  .methodology ol{padding-left:1.1em; margin:10px 0 0;}
  .methodology li{margin-bottom:10px; color:var(--ink-soft); font-size:0.94rem;}
  .methodology li strong{color:var(--ink);}

  footer.sources{
    margin-top:56px;
    padding-top:24px;
    border-top:1px solid var(--line);
    color:var(--muted);
    font-size:0.86rem;
  }
  footer.sources h4{
    font-family:"Fraunces", serif;
    font-weight:600;
    color:var(--ink-soft);
    font-size:0.95rem;
    margin:0 0 10px;
  }
  footer.sources ul{margin:0; padding-left:1.1em; columns:2; column-gap:24px;}
  footer.sources li{margin-bottom:6px; break-inside:avoid;}
  footer.sources a{color:var(--ink-soft); text-decoration:underline; text-decoration-color:var(--line-strong);}

  @media (max-width: 760px){
    .map-card{grid-template-columns:1fr;}
    .stat-strip{grid-template-columns:repeat(2,1fr);}
    footer.sources ul{columns:1;}
  }


  /* --- Added for the scripted report renderer (scripts/report/) --- */

  /* A 6th stat cell (the cattle-grazing update) needs a wider grid than
     the original 5-column layout. */
  .stat-strip.cols-6{grid-template-columns:repeat(6,1fr);}
  @media (max-width: 760px){
    .stat-strip.cols-6{grid-template-columns:repeat(2,1fr);}
  }


  /* "grazing" is a 5th finding category (the cattle/grazing update),
     reusing --bark (already defined above in both themes) rather than
     introducing a new colour -- it reads naturally as cattle/grazing and
     keeps the same "four steps, one shared hue per theme" pattern the
     other categories use. */
  .card.grazing{border-left-color:var(--bark);}
  .pin-chip.grazing{background:var(--bark);}
  .status-label.grazing{background:color-mix(in srgb, var(--bark) 18%, transparent); color:var(--bark);}

  /* The dashed outline on the map showing the area this report searches
     for updates in (see "This week on the map"). */
  .search-area{
    fill:none;
    stroke:var(--line-strong);
    stroke-width:1.2;
    stroke-dasharray:5 4;
  }

  .map-caption{
    font-size:0.84rem;
    color:var(--muted);
    margin:10px 0 0;
  }
  .map-caption .search-key{display:inline-flex; align-items:center; gap:6px;}
  .map-caption .search-swatch{
    display:inline-block; width:14px; height:0; border-top:1.4px dashed var(--line-strong);
  }

  .app-link{
    display:inline-flex;
    align-items:center;
    gap:8px;
    margin-top:14px;
    padding:9px 16px;
    background:#f4f4ec;
    color:var(--forest-deep);
    font-weight:600;
    font-size:0.92rem;
    border-radius:999px;
    text-decoration:none;
  }
  .app-link:hover, .app-link:focus-visible{ text-decoration:underline; }

  /* "What's on the map" -- the running inventory of everything the app can
     draw, headline total plus a breakdown by the app's own filter groups.
     The total sits in the card's own header rather than the stat strip at
     the top, which is strictly about what changed this week. */
  .inventory-card{
    background:var(--surface);
    border:1px solid var(--line);
    border-radius:16px;
    box-shadow:var(--shadow);
    overflow:hidden;
  }
  .inventory-head{
    display:flex;
    align-items:baseline;
    gap:14px;
    flex-wrap:wrap;
    padding:20px 22px;
    border-bottom:1px solid var(--line);
    background:var(--surface-2);
  }
  .inventory-head .n{
    font-family:"JetBrains Mono", monospace;
    font-variant-numeric: tabular-nums;
    font-size:2.4rem;
    font-weight:600;
    line-height:1;
  }
  .inventory-head .lbl{color:var(--ink-soft); font-size:0.95rem;}
  .inventory-groups{
    display:grid;
    grid-template-columns:repeat(3,1fr);
    gap:1px;
    background:var(--line);
  }
  .inventory-group{background:var(--surface); padding:16px 20px 18px;}
  /* The always-shown features have no filter to sit beside, so they get a
     row of their own rather than leaving two empty cells next to them. */
  .inventory-group.full{grid-column:1 / -1;}
  .inventory-group .grp{
    display:flex;
    align-items:baseline;
    justify-content:space-between;
    gap:10px;
    font-weight:600;
    margin-bottom:8px;
  }
  .inventory-group .grp .c{
    font-family:"JetBrains Mono", monospace;
    font-variant-numeric: tabular-nums;
  }
  .inventory-group ul{margin:0; padding:0; list-style:none;}
  .inventory-group li{
    display:flex;
    justify-content:space-between;
    gap:10px;
    font-size:0.88rem;
    color:var(--ink-soft);
    padding:2px 0;
  }
  .inventory-group li .c{
    font-family:"JetBrains Mono", monospace;
    font-variant-numeric: tabular-nums;
  }
  @media (max-width: 760px){
    .inventory-groups{grid-template-columns:1fr;}
  }

  .about-note{
    margin-top:40px;
    padding:18px 20px;
    background:var(--surface-2);
    border-radius:12px;
    border:1px solid var(--line);
    color:var(--ink-soft);
    font-size:0.92rem;
  }

  /* The cattle marker: the app's own white map pin with its cow icon inside,
     so a cow reads as a cow here exactly as it does on the map. Used in the
     legend, the list beside the map, and on the cattle card. The map SVG
     draws the same shape -- see .cow-pin-body / .cow-pin-icon below. */
  .cow-marker{
    background-color:#fff !important;
    background-image:var(--cow-icon);
    background-size:76% 76%;
    background-position:center;
    background-repeat:no-repeat;
    border:1px solid var(--line-strong);
    display:inline-block;
    flex:none;
  }
  .legend-item .cow-marker{width:17px;height:17px;border-radius:50%;}
  .cow-pin-body{fill:#fff; stroke:rgba(0,0,0,0.25); stroke-width:1.1;}

  /* The advert for the app itself, near the foot of the report -- after the
     week's news, where a reader has a reason to want the map. */
  .app-promo{
    background:var(--surface);
    border:1px solid var(--line);
    border-radius:16px;
    box-shadow:var(--shadow);
    padding:26px 28px 24px;
  }
  .app-promo .section-sub{margin-bottom:18px; max-width:62ch;}
  .promo-points{
    list-style:none;
    margin:0 0 22px;
    padding:0;
    display:grid;
    grid-template-columns:repeat(2,minmax(0,1fr));
    gap:16px 28px;
  }
  .promo-points li{display:flex; flex-direction:column; gap:2px;}
  .promo-points strong{font-size:0.95rem;}
  .promo-points span{color:var(--ink-soft); font-size:0.9rem;}
  .promo-cta{margin:0;}
  /* The masthead version of this button sat on the dark green header; here it
     sits on a light card, so it needs the colours the other way round. */
  .app-promo .app-link{
    margin-top:0;
    background:var(--forest-deep);
    color:#f4f4ec;
    padding:12px 22px;
    font-size:1rem;
  }
  .promo-foot{margin:14px 0 0; color:var(--muted); font-size:0.85rem;}
  @media (max-width: 760px){
    .promo-points{grid-template-columns:1fr;}
  }

  /* "Nothing to report" cards: present on purpose, so a quiet week reads as a
     quiet week rather than a missing section. */
  .card.empty h3{font-size:1rem;}
  .card.empty p{margin-bottom:0;}

  /* The AI-authored notice. Last thing on the page, quiet but not hidden. */
  .ai-note{
    margin-top:40px;
    padding:18px 20px;
    border:1px dashed var(--line-strong);
    border-radius:12px;
    color:var(--ink-soft);
    font-size:0.88rem;
  }
  .ai-note h4{
    font-family:"Fraunces", serif;
    font-weight:600;
    font-size:0.95rem;
    color:var(--ink);
    margin:0 0 8px;
  }
  .ai-note p{margin:0 0 8px;}
  .ai-note p:last-child{margin-bottom:0;}
"""

FONT_LINKS = (
    '<link rel="preconnect" href="https://fonts.googleapis.com">\n'
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
    '<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,340;0,9..144,480;0,9..144,600;0,9..144,720;1,9..144,480;1,9..144,600&family=Public+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">'
)
