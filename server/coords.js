// Coordinate mapping — the one part of this app that must be mathematically exact.
//
// pdf.js renders in CSS pixels, top-left origin, at an arbitrary zoom.
// pdf-lib places content in PDF points (72/inch), bottom-left origin, in the
// page's UNROTATED coordinate space (page.getSize() always returns the raw
// MediaBox size, regardless of /Rotate).
//
// We never store pixels. Every field is stored as fractions (0..1) of the
// pdf.js viewport at scale=1 — i.e. `viewport = page.getViewport({ scale: 1 })`,
// then `fx = px / viewport.width`, `fy = py / viewport.height`. Because pdf.js's
// viewport already applies /Rotate, those fractions describe the field in
// *displayed* (rotated) space. We also store the page's rotation at placement
// time so we can transform back into the page's native unrotated space before
// handing coordinates to pdf-lib.
//
// toPdfSpace() does exactly that transform, then converts to PDF points with
// a Y-flip (top-left fractions -> bottom-left points), anchoring the box at
// its bottom-left corner (pdf-lib drawImage/drawText both anchor bottom-left).

/**
 * @param {{x:number,y:number,w:number,h:number}} field fractions (0..1) in
 *   pdf.js viewport space (rotation already applied by pdf.js).
 * @param {number} rotation page rotation in degrees as reported by pdf.js /
 *   pdf-lib (`page.getRotation().angle`) — normalized to one of 0/90/180/270.
 * @param {{width:number,height:number}} pageSize the page's UNROTATED size in
 *   PDF points, i.e. `page.getSize()` from pdf-lib.
 * @returns {{x:number,y:number,w:number,h:number}} box in PDF points, in the
 *   page's native unrotated coordinate space, anchored bottom-left — ready to
 *   pass straight to `page.drawImage`/`page.drawText`/`page.drawRectangle`.
 */
export function toPdfSpace(field, rotation, pageSize) {
  const { x: fx, y: fy, w: fw, h: fh } = field;
  const rot = ((Number(rotation) % 360) + 360) % 360;

  let nfx, nfy, nfw, nfh;
  switch (rot) {
    case 90:
      nfx = fy;
      nfy = 1 - fx - fw;
      nfw = fh;
      nfh = fw;
      break;
    case 180:
      nfx = 1 - fx - fw;
      nfy = 1 - fy - fh;
      nfw = fw;
      nfh = fh;
      break;
    case 270:
      nfx = 1 - fy - fh;
      nfy = fx;
      nfw = fh;
      nfh = fw;
      break;
    case 0:
    default:
      nfx = fx;
      nfy = fy;
      nfw = fw;
      nfh = fh;
      break;
  }

  const { width, height } = pageSize;
  return {
    x: nfx * width,
    y: height - (nfy + nfh) * height,
    w: nfw * width,
    h: nfh * height,
  };
}

/** Clamp a rotation value (may be negative or >360) to one of 0/90/180/270. */
export function normalizeRotation(rotation) {
  const r = ((Number(rotation) || 0) % 360 + 360) % 360;
  return [0, 90, 180, 270].includes(r) ? r : 0;
}
