/**
 * Inline CSS for the report: dark photographic theme, warm
 * golden-hour accent palette, restrained typography. Kept in its own module
 * so `render.ts` stays focused on markup assembly.
 *
 * Responsive strategy: the layout is fluid by default -- `clamp()` on the
 * gutters and the display type, `auto-fit` for the card grid, percentage-placed
 * hour labels over a stretched timeline -- so nothing is pinned to a viewport
 * size. The one hard breakpoint (`NARROW_QUERY`) handles the two things
 * fluidity cannot: label collision on the hour axis and the fixed-width swatch
 * columns of the band key.
 */

/**
 * Below this width a phone is holding the report in one hand: gutters are
 * already at their `clamp()` floor and the remaining content column is about
 * 20rem, which is where the hour axis's 3-hourly labels start to collide.
 */
const NARROW_QUERY = '@media (max-width: 34rem)';

export const REPORT_CSS = `
  :root {
    color-scheme: dark;
    --bg: #0c0b10;
    --bg-panel: #17151d;
    --bg-panel-2: #1f1c26;
    --fg: #ece7de;
    --fg-muted: #a49d92;
    --accent: #e8a33d;
    --accent-2: #f2c879;
    --border: #33303c;
    --daylight: #3b3524;
    --night: #100e15;
  }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    background: radial-gradient(ellipse at top, #1a1620 0%, var(--bg) 60%);
    color: var(--fg);
    font-family: Georgia, 'Iowan Old Style', 'Palatino Linotype', serif;
    line-height: 1.5;
  }

  /* Gutters shrink with the viewport rather than at a breakpoint: at 1.5rem a
     side, a 360px phone spends a sixth of its width on whitespace before the
     panel's own padding is counted. */
  .wrap {
    max-width: 960px;
    margin: 0 auto;
    padding: clamp(1rem, 3vw, 2rem) clamp(0.85rem, 4vw, 1.5rem) clamp(2rem, 6vw, 3rem);
  }

  header.report-header {
    padding: clamp(1.25rem, 5vw, 2.5rem) 0 clamp(1rem, 3vw, 1.5rem);
    border-bottom: 1px solid var(--border);
    margin-bottom: clamp(1.25rem, 4vw, 2rem);
  }

  header.report-header .kicker {
    text-transform: uppercase;
    letter-spacing: 0.18em;
    font-size: 0.72rem;
    color: var(--accent-2);
    margin: 0 0 0.4rem;
  }

  header.report-header h1 {
    margin: 0 0 0.35rem;
    font-size: clamp(1.5rem, 6vw, 2.1rem);
    font-weight: 600;
    color: var(--fg);
    /* Geocoded place names are arbitrary strings and can be a single long
       token, which would otherwise push the page wider than the viewport. */
    overflow-wrap: break-word;
  }

  header.report-header .date-range {
    color: var(--fg-muted);
    font-size: 1rem;
  }

  .day-section {
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: clamp(0.9rem, 3vw, 1.25rem) clamp(0.75rem, 3.5vw, 1.5rem) clamp(1rem, 3.5vw, 1.5rem);
    margin-bottom: 1.25rem;
  }

  .day-section h2 {
    margin: 0 0 0.25rem;
    font-size: 1.15rem;
    font-weight: 600;
    color: var(--accent-2);
  }

  .day-meta {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    margin: 0 0 0.6rem;
    font-size: 0.8rem;
    color: var(--fg-muted);
  }

  .daylight-key {
    width: 1.6rem;
    height: 0.6rem;
    border-radius: 2px;
    background: var(--daylight);
    border: 1px solid var(--border);
  }

  .timeline-wrap { margin-bottom: 1rem; }

  /* The strip stretches its x axis to any width (preserveAspectRatio="none"),
     so only its height needs setting; it loses a little on narrow screens where
     vertical room is scarcer than horizontal. */
  .timeline {
    width: 100%;
    height: clamp(42px, 11vw, 56px);
    display: block;
    background: var(--night);
    border: 1px solid var(--border);
    border-radius: 4px;
  }

  .daylight-band { fill: var(--daylight); }
  .hour-grid { fill: rgba(236, 231, 222, 0.12); }

  .window-band { stroke: rgba(0, 0, 0, 0.5); stroke-width: 1; }
  /* A light outline, not a gold one: gold is a band hue now, so an accent-gold
     highlight would vanish on exactly the golden-hour bands it marks most. */
  .window-band.ideal-sky { stroke: var(--fg); stroke-width: 2; }
  /* Clipped at local midnight: the dashed right edge marks the band as
     continuing past the end of this row rather than ending there. */
  .runs-past-midnight { stroke-dasharray: 5 4; }

  /* Hour labels are absolutely positioned over a bare row so they can sit at
     the same percentages as the gridlines in the SVG above. */
  .hour-axis {
    position: relative;
    height: 1.1rem;
    margin-top: 0.3rem;
    font-size: 0.7rem;
    letter-spacing: 0.05em;
    color: var(--fg-muted);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  .hour-axis .hour-mark { position: absolute; top: 0; transform: translateX(-50%); }
  .hour-axis .hour-mark.start { transform: none; }
  .hour-axis .hour-mark.end { transform: translateX(-100%); }

  /* min(190px, 100%) rather than a bare 190px track: on a container narrower
     than one card the minimum would otherwise win and overflow the panel. */
  .window-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(190px, 100%), 1fr));
    gap: 0.75rem;
  }

  .window-card {
    background: var(--bg-panel-2);
    border: 1px solid var(--border);
    border-left: 4px solid var(--band, var(--border));
    border-radius: 8px;
    padding: 0.7rem 0.85rem 0.75rem;
  }
  .window-card.ideal {
    border-color: rgba(236, 231, 222, 0.45);
    border-left-color: var(--band, var(--accent));
    box-shadow: inset 0 0 0 1px rgba(236, 231, 222, 0.14);
  }
  .window-card p { margin: 0; }

  .wc-type {
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--fg-muted);
  }
  .wc-time { font-size: 1.05rem; color: var(--fg); font-variant-numeric: tabular-nums; }
  .wc-next-day { font-size: 0.68rem; color: var(--accent-2); margin-left: 0.35rem; }
  .window-card .wc-cond { font-size: 0.85rem; color: var(--fg-muted); margin-bottom: 0.6rem; }
  .wc-ideal { color: var(--accent-2); font-weight: 600; margin-left: 0.4rem; white-space: nowrap; }

  /* The cloud figures, set off from the times above by a rule rather than by a
     panel: the card is small enough that a nested box would read as a second
     card. */
  .wc-cloud { border-top: 1px solid var(--border); padding-top: 0.55rem; }
  .window-card .wc-cloud-label {
    font-size: 0.62rem;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--fg-muted);
    margin-bottom: 0.2rem;
  }

  .cloud-key { list-style: none; margin: 0; padding: 0; font-size: 0.78rem; color: var(--fg-muted); }
  /* Label left, figure right: three rows of right-aligned tabular numerals are
     comparable down the column and across cards, which is the only comparison
     these three independent measurements support. */
  .cloud-key li { display: flex; align-items: baseline; gap: 0.4rem; line-height: 1.45; }
  .cloud-key b { margin-left: auto; color: var(--fg); font-weight: 600; font-variant-numeric: tabular-nums; }
  /* Total is a separate whole-sky reading, not the sum of the three above it:
     the rule keeps it from being read as a column total. */
  .cloud-key .cloud-total { margin-top: 0.3rem; padding-top: 0.3rem; border-top: 1px solid var(--border); }

  .polar-banner {
    background: linear-gradient(135deg, var(--bg-panel-2), var(--bg-panel));
    border: 1px dashed var(--accent);
    border-radius: 10px;
    padding: clamp(0.9rem, 3vw, 1.1rem) clamp(0.75rem, 3.5vw, 1.5rem);
    margin-bottom: 1.25rem;
    color: var(--fg);
  }
  .polar-banner .polar-title { color: var(--accent-2); font-weight: 600; margin: 0 0 0.35rem; }
  /* Same banner frame, cooler accent: an ordinary day with no completed
     windows is a different situation from a polar day and should not read as
     one at a glance. */
  .no-windows-banner { border-style: dotted; border-color: var(--fg-muted); }

  footer.report-footer {
    margin-top: clamp(1.5rem, 5vw, 2.5rem);
    padding-top: clamp(1rem, 3vw, 1.5rem);
    border-top: 1px solid var(--border);
    color: var(--fg-muted);
    font-size: 0.85rem;
  }

  footer.report-footer h3 { color: var(--fg); font-size: 0.95rem; margin: 1.25rem 0 0.5rem; }

  /* Dataset field names in the footer prose. em-relative so the mono face
     tracks the surrounding text instead of jumping a size, as browser defaults
     for a code element otherwise do. */
  footer.report-footer code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.95em;
    color: var(--fg);
  }

  /* Last-resort escape hatch for the footer tables: they shrink first (see the
     narrow block below), and only scroll within their own box if a very small
     viewport or a large default font still leaves them wider than the column.
     The page body never scrolls sideways. */
  .table-scroll { overflow-x: auto; margin-bottom: 1rem; }

  table.wmo-table { border-collapse: collapse; width: 100%; font-size: 0.8rem; }
  table.wmo-table th, table.wmo-table td {
    text-align: left;
    padding: 0.3rem 0.6rem;
    border-bottom: 1px solid var(--border);
  }
  table.band-key td:not(:first-child), table.band-key th:not(:first-child) { width: 6.5rem; }
  .band-swatch {
    display: block;
    width: 3rem;
    height: 0.9rem;
    border-radius: 2px;
    border: 1px solid rgba(0, 0, 0, 0.5);
  }

  .attribution a { color: var(--accent-2); }

  ${NARROW_QUERY} {
    /* Every third hour is too dense to label in a ~20rem column, so the axis
       falls back to a 6-hourly scale. The gridlines behind it stay 3-hourly:
       the unlabeled ticks still read as midpoints, and the SVG is shared by
       every width. */
    .hour-axis .hour-mark.secondary { display: none; }

    /* The band key's two swatch columns are fixed-width, so on a narrow screen
       they would crowd out the sky-tier labels that name the rows. */
    table.band-key td:not(:first-child), table.band-key th:not(:first-child) { width: 3.4rem; }
    .band-swatch { width: 2.2rem; }
    table.wmo-table th, table.wmo-table td { padding: 0.3rem 0.4rem; }
  }
`;
