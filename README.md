# Drawing Annotator

A small web app for annotating a multipage construction drawing:

- View the multipage PDF (`residential-townhouse-remodel.pdf`, 15 pages) and move between pages.
- Draw **green rectangles** around text to capture. OCR runs locally in the browser and the extracted text is shown in the sidebar and saved.
- Draw **red rectangles** around content to ignore.
- Annotations auto-save to the server and persist across app restarts.

## Run

Requires Node.js (no npm install needed, zero dependencies).

```bash
node server.js
# open http://localhost:3000  (or PORT=3456 node server.js)
```

## How to use

- **Capture / Ignore** buttons (or `C` / `I` keys) switch drawing mode.
- Drag on the page to draw a rectangle. Green rectangles are OCR'd immediately.
- `←` / `→` buttons or arrow keys change pages.
- Click a rectangle (or its sidebar entry) to select; press `Delete` to remove it.
- Saving is automatic (debounced); status shows in the toolbar.

## Architecture

- **Server** (`server.js`): plain Node `http`, serves static files and a two-endpoint JSON API (`GET`/`PUT /api/annotations`). Annotations persist to `data/annotations.json`.
- **Frontend** (`public/`): vanilla JS modules.
  - **PDF.js** (CDN) renders pages to a canvas, scaled to fit the viewport (with devicePixelRatio-aware backing store).
  - Rectangles are stored in **normalized page coordinates** (0-1), so they stay anchored regardless of zoom, window size, or display density.
  - **Tesseract.js** (CDN) does OCR fully client-side: the green region is re-rendered from the PDF at 4x scale to an offscreen canvas for better accuracy, then recognized. Extracted text is saved with the annotation.

## Priorities (within the 1-hour limit)

1. Core loop first: view, navigate, draw, persist. That's the product.
2. Normalized coordinates from the start, since resize/zoom correctness is much harder to retrofit.
3. OCR bonus, since re-rendering the crop at high resolution from the vector PDF (instead of scraping the screen canvas) gives dramatically better results on small drawing text.
4. Light UX: mode toggle, selection + delete, keyboard shortcuts, save status indicator.

## Tradeoffs

- **Vanilla JS over React**: for one page-sized UI this avoids build tooling and keeps the whole app readable in three small files. In a real product I'd use React/TypeScript as the annotation state grows.
- **JSON file over a database**: a single-user take-home doesn't need more; the API boundary means swapping in SQLite/Postgres later is trivial.
- **CDN libraries**: no build step, instant start. Would vendor/lock versions for production.
- **Whole-document save on change**: simplest correct thing at this scale; per-annotation PATCH would be next with concurrency concerns.

## Next steps

- Move/resize existing rectangles (drag handles).
- Zoom and pan for detailed work on large sheets.
- Editable OCR text (human correction), and re-run OCR button.
- Export captured text (CSV/JSON) grouped by page.
- Multi-document support: upload any PDF instead of the bundled one.
