# Ledgr campaign flyer — editable source & exports

This campaign was built from checked-in, editable vector artwork. The export does **not** use a captured application screenshot: the product panel is a neutral, clearly labelled **illustrative view**. The values shown in that illustration are decorative sample content, not claims about a customer account or live demo data.

## Files

- `design.svg.tpl` — SVG master layout (native editable text, vector shapes, gradients and data placeholders).
- `campaign.json` — campaign copy, module descriptions, contact details and key lines; edit this for text changes.
- `../tools/render.mjs` — export script, four layout settings, and PNG/vector-PDF generation.
- `output/ledgr-master-a4.{png,pdf,svg}` — print master, A4 portrait; 2480 × 3508 px PNG (300 dpi) and vector PDF.
- `output/ledgr-whatsapp-portrait.{png,pdf,svg}` — 1080 × 1350 px.
- `output/ledgr-whatsapp-status.{png,pdf,svg}` — 1080 × 1920 px.
- `output/ledgr-social-square.{png,pdf,svg}` — 1080 × 1080 px.

The SVG exports open in Illustrator, Inkscape, Figma (import), Affinity Designer and other SVG editors. Edit text and shapes directly, or change `campaign.json` and rerun the generator. The A4 PDF uses A4 page dimensions and retains vector text/art; the social PDFs have matching aspect ratios for convenience.

## Regenerate

From the repository root, after npm dependencies are installed:

```sh
node marketing/tools/render.mjs
```

Rendering uses `sharp`, `pdfkit`, and `svg-to-pdfkit` from `marketing/package.json`.

## Product-accuracy notes

- Finance, sales/POS, inventory, organisation branches/locations, construction procurement and Ledgr AI are present in the application; plan and organisation-capability gates apply.
- There is no independent general purchasing module. Supplier contacts are supported; procurement is presented as part of Construction, not as a separate module.
- Ledgr AI insights and forecasting are restricted by plan/partner entitlement. The flyer describes this as access on eligible plans.
- No claims about savings, profitability, or guaranteed outcomes are made.

Contact details included in the source are exact: **0881 444 487** and **gremu.consultancy@gmail.com**.
