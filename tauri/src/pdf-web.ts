import {
  PDFDocument,
  degrees,
  PDFName,
  PDFArray,
} from "pdf-lib";

export interface PdfAnalysis {
  file_name: string;
  ratios: Record<string, number>;
}

export interface PdfResizeResult {
  target_w: number;
  target_h: number;
  blob: Blob;
}

function appError(type: string): Error {
  return new Error(JSON.stringify({ type }));
}

function getRatioClass(w: number, h: number): string {
  if (w <= 0 || h <= 0) {
    return "invalid";
  }

  // 1. Применяем логику Rust: всегда делим большую сторону на меньшую
  const longSide = Math.max(w, h);
  const shortSide = Math.min(w, h);
  const r = longSide / shortSide;

  // 2. Используем ту же точность, что и в Rust (0.02)
  const epsilon = 0.02;

  if (Math.abs(r - 1.4142) < epsilon) return "a_series";
  if (Math.abs(r - 1.3333) < epsilon) return "4_3";
  if (Math.abs(r - 1.7777) < epsilon) return "16_9";
  if (Math.abs(r - 1.2941) < epsilon) return "letter";
  if (Math.abs(r - 1.647) < epsilon) return "legal";
  if (Math.abs(r - 1.5) < epsilon) return "2_3";

  return `custom:${w.toFixed(2)}:${h.toFixed(2)}`;
}

async function loadPdfDocument(file: File): Promise<PDFDocument> {
  try {
    const bytes = await file.arrayBuffer();
    return await PDFDocument.load(bytes, { ignoreEncryption: true });
  } catch {
    throw appError("PdfLoadFailed");
  }
}

export async function analyzePdfWeb(file: File | null): Promise<PdfAnalysis> {
  if (!file) {
    throw appError("EmptyPath");
  }

  const doc = await loadPdfDocument(file);
  const pages = doc.getPages();

  if (pages.length === 0) {
    throw appError("PageStructureError");
  }

  const ratios: Record<string, number> = {};

  for (const page of pages) {
    const mediaBox = page.getMediaBox();
    const width = mediaBox.width;
    const height = mediaBox.height;

    if (width <= 0 || height <= 0) {
      throw appError("InvalidDimensions");
    }

    const className = getRatioClass(width, height);
    ratios[className] = (ratios[className] ?? 0) + 1;
  }

  return {
    file_name: file.name,
    ratios,
  };
}

export async function resizePdfWeb(
  file: File | null,
  wRatio: number,
  hRatio: number,
): Promise<PdfResizeResult> {
  if (!file) throw appError("EmptyPath");
  if (wRatio <= 0 || hRatio <= 0) throw appError("InvalidRatio");

  const pdfDoc = await loadPdfDocument(file);
  const pages = pdfDoc.getPages();
  const targetW = 595.0;
  const targetH = targetW * (hRatio / wRatio);

  for (const page of pages) {
    const mediaBox = page.getMediaBox();
    const currentWidth = mediaBox.width;
    const currentHeight = mediaBox.height;
    
    // ВАЖНО: Получаем начальные координаты для корректного смещения (аналог orig_left / orig_bottom)
    const origLeft = mediaBox.x;
    const origBottom = mediaBox.y;

    const rotation = page.getRotation().angle;

    // Математика трансформации, дословно переведенная из Rust
    let scale = 1;
    let a = 1, b = 0, c = 0, d = 1, e = 0, f = 0;

    switch (rotation) {
      case 90: {
        scale = Math.min(targetW / currentHeight, targetH / currentWidth);
        const newContentW = currentHeight * scale;
        const newContentH = currentWidth * scale;
        const offsetX = (targetW - newContentW) / 2;
        const offsetY = (targetH - newContentH) / 2;

        a = 0; b = -scale; c = scale; d = 0;
        e = offsetX - (origBottom * scale);
        f = offsetY + (currentWidth * scale) + (origLeft * scale);
        break;
      }
      case 180: {
        scale = Math.min(targetW / currentWidth, targetH / currentHeight);
        const newContentW = currentWidth * scale;
        const newContentH = currentHeight * scale;
        const offsetX = (targetW - newContentW) / 2;
        const offsetY = (targetH - newContentH) / 2;

        a = -scale; b = 0; c = 0; d = -scale;
        e = offsetX + (currentWidth * scale) + (origLeft * scale);
        f = offsetY + (currentHeight * scale) + (origBottom * scale);
        break;
      }
      case 270: {
        scale = Math.min(targetW / currentHeight, targetH / currentWidth);
        const newContentW = currentHeight * scale;
        const newContentH = currentWidth * scale;
        const offsetX = (targetW - newContentW) / 2;
        const offsetY = (targetH - newContentH) / 2;

        a = 0; b = scale; c = -scale; d = 0;
        e = offsetX + (currentHeight * scale) + (origBottom * scale);
        f = offsetY - (origLeft * scale);
        break;
      }
      default: {
        scale = Math.min(targetW / currentWidth, targetH / currentHeight);
        const newContentW = currentWidth * scale;
        const newContentH = currentHeight * scale;
        const offsetX = (targetW - newContentW) / 2;
        const offsetY = (targetH - newContentH) / 2;

        a = scale; b = 0; c = 0; d = scale;
        e = offsetX - (origLeft * scale);
        f = offsetY - (origBottom * scale);
        break;
      }
    }

    // 1. Создаем поток q + cm (Prepend)
    const prependStream = pdfDoc.context.flateStream(
      `q\n${a.toFixed(4)} ${b.toFixed(4)} ${c.toFixed(4)} ${d.toFixed(4)} ${e.toFixed(4)} ${f.toFixed(4)} cm\n`
    );
    const prependRef = pdfDoc.context.register(prependStream);

    // 2. Создаем поток Q (Append)
    const appendStream = pdfDoc.context.flateStream("\nQ\n");
    const appendRef = pdfDoc.context.register(appendStream);

    // 3. Достаем старый Contents страницы и собираем новый массив (1-в-1 как в lopdf)
    const contents = page.node.get(PDFName.of("Contents"));
    const newContentsArray = pdfDoc.context.obj([prependRef]);

    if (contents instanceof PDFArray) {
      for (let i = 0; i < contents.size(); i++) {
        newContentsArray.push(contents.get(i));
      }
    } else if (contents) {
      newContentsArray.push(contents);
    }

    newContentsArray.push(appendRef);
    
    // Перезаписываем Contents
    page.node.set(PDFName.of("Contents"), newContentsArray);

    // Установка параметров страницы
    page.setMediaBox(0, 0, targetW, targetH);
    page.setCropBox(0, 0, targetW, targetH);
    page.setRotation(degrees(0));
  }

  const outBytes = await pdfDoc.save();
  return {
    target_w: targetW,
    target_h: targetH,
    blob: new Blob([new Uint8Array(outBytes)], { type: "application/pdf" }),
  };
}

export function downloadPdfBlob(blob: Blob, fileName: string): void {
  const blobUrl = URL.createObjectURL(blob);
  const downloadAnchor = document.createElement("a");
  downloadAnchor.href = blobUrl;
  downloadAnchor.download = fileName;
  downloadAnchor.click();
  URL.revokeObjectURL(blobUrl);
}
