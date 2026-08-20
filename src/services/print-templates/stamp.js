// Real scanned stamp graphic, date pre-removed (see assets/stamp-blank.png).
// Original kept at assets/stamp-original.png for reference only.
//
// IMPORTANT (print/PDF reliability): do NOT reference the stamp via a
// webpack-resolved or relative <img src="..."> path. When the letter HTML
// is loaded into a hidden BrowserWindow for printToPDF() (via a data: URI
// or temp file), that context has no base URL to resolve relative/dev
// paths against, so the image silently fails to load while the rest of
// the letter still prints fine. Instead, inline the PNG as base64 once,
// at generation time, so there is no path to resolve at all.
//
// In the main/print process (Node context), load it like this:
//   import { readFileSync } from 'fs';
//   import { join } from 'path';
//   const stampDataUri = 'data:image/png;base64,' +
//     readFileSync(join(__dirname, '../assets/stamp-blank.png')).toString('base64');
// then pass it in as options.imageDataUri below. Cache it — don't re-read
// the file on every print.
//
// For on-screen preview inside the Quasar/Vue renderer, a normal
// `import stampImg from '../assets/stamp-blank.png'` works fine and can
// be passed the same way.

// Original scan is 969x674. The baked-in date sat at x:108-661, y:275-359.
const STAMP_NATURAL_WIDTH = 969;
const STAMP_NATURAL_HEIGHT = 674;
const DATE_BOX = { left: 108, top: 275, right: 661, bottom: 359 };

function formatStampDate(dateInput) {
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return '';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy} -${mm}- ${dd}`;
}

/**
 * Renders the stamp image with the correct date overlaid in the same
 * spot the original wheel-date printed. `width` is the on-page render
 * width in px; everything else scales off the 969px source image.
 */
export function renderStamp(date, options = {}) {
  const { width = 190, imageSrc } = options;
  if (!imageSrc) {
    throw new Error(
      'renderStamp: pass options.imageSrc (a base64 data URI for print reliability, ' +
      'e.g. "data:image/png;base64,...")'
    );
  }
  const scale = width / STAMP_NATURAL_WIDTH;
  const height = Math.round(STAMP_NATURAL_HEIGHT * scale);

  const left = DATE_BOX.left * scale;
  const top = DATE_BOX.top * scale;
  const boxWidth = (DATE_BOX.right - DATE_BOX.left) * scale;
  const boxHeight = (DATE_BOX.bottom - DATE_BOX.top) * scale;
  const fontSize = boxHeight * 0.68;

  return `
  <div style="position: relative; width: ${width}px; height: ${height}px;">
    <img src="${imageSrc}" alt="Company stamp" width="${width}" height="${height}"
      style="display: block; width: ${width}px; height: ${height}px;" />
    <div style="
      position: absolute;
      left: ${left}px;
      top: ${top}px;
      width: ${boxWidth}px;
      height: ${boxHeight}px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: 'Consolas', 'DejaVu Sans Mono', 'Courier New', monospace;
      font-weight: 700;
      font-size: ${fontSize}px;
      letter-spacing: ${fontSize * 0.1}px;
      color: #1a1a1a;
      opacity: 0.86;
      mix-blend-mode: multiply;
      white-space: nowrap;
    ">${formatStampDate(date || new Date())}</div>
  </div>`;
}

/**
 * Placed below the signature, left-aligned, per the letter layout.
 */
export function renderStampBlock(date, options = {}) {
  const { width = 190, marginTop = 14, imageSrc } = options;
  return `
  <div style="margin-top: ${marginTop}px; text-align: left;">
    ${renderStamp(date, { width, imageSrc })}
  </div>`;
}