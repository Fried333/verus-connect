import qrcode from 'qrcode-generator';

/**
 * Generate a QR code as an SVG string.
 * Uses qrcode-generator which is tiny (~12KB) with zero deps.
 */
export function generateQrSvg(data: string, size = 256): string {
  const qr = qrcode(0, 'M');
  qr.addData(data);
  qr.make();

  const moduleCount = qr.getModuleCount();
  const cellSize = size / moduleCount;
  const margin = 0;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`;
  svg += `<rect width="${size}" height="${size}" fill="#ffffff"/>`;

  for (let row = 0; row < moduleCount; row++) {
    for (let col = 0; col < moduleCount; col++) {
      if (qr.isDark(row, col)) {
        const x = col * cellSize + margin;
        const y = row * cellSize + margin;
        svg += `<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" fill="#000000"/>`;
      }
    }
  }

  svg += '</svg>';
  return svg;
}

/**
 * Generate a QR code as a data URL (SVG-based, no canvas needed).
 */
export function generateQrDataUrl(data: string, size = 256): string {
  const svg = generateQrSvg(data, size);
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}
