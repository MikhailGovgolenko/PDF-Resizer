import { PDFDocument } from "pdf-lib";

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
  if (h === 0) {
    return "invalid";
  }

  const r = w / h;
  if (Math.abs(r - 1.4142) < 0.03) {
    return "a_series";
  }
  if (Math.abs(r - 1.3333) < 0.03) {
    return "4_3";
  }
  if (Math.abs(r - 1.7777) < 0.03) {
    return "16_9";
  }
  if (Math.abs(r - 0.75) < 0.03) {
    return "3_4";
  }
  if (Math.abs(r - 0.6666) < 0.03) {
    return "2_3";
  }

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
    const { width, height } = page.getSize();
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
  hRatio: number
): Promise<PdfResizeResult> {
  if (!file) {
    throw appError("EmptyPath");
  }
  if (wRatio <= 0 || hRatio <= 0) {
    throw appError("InvalidRatio");
  }

  const srcDoc = await loadPdfDocument(file);
  const pages = srcDoc.getPages();

  if (pages.length === 0) {
    throw appError("PageStructureError");
  }

  const targetW = 595;
  const targetH = targetW * (hRatio / wRatio);
  const outDoc = await PDFDocument.create();

  for (const srcPage of pages) {
    const { width: currentWidth, height: currentHeight } = srcPage.getSize();
    if (currentWidth <= 0 || currentHeight <= 0) {
      throw appError("InvalidDimensions");
    }

    const embeddedPage = await outDoc.embedPage(srcPage);
    const scale = Math.min(targetW / embeddedPage.width, targetH / embeddedPage.height);
    const drawWidth = embeddedPage.width * scale;
    const drawHeight = embeddedPage.height * scale;
    const x = (targetW - drawWidth) / 2;
    const y = (targetH - drawHeight) / 2;

    const newPage = outDoc.addPage([targetW, targetH]);
    newPage.drawPage(embeddedPage, {
      x,
      y,
      width: drawWidth,
      height: drawHeight,
    });
  }

  try {
    const outBytes = await outDoc.save();
    return {
      target_w: targetW,
      target_h: targetH,
      blob: new Blob([outBytes.buffer.slice(outBytes.byteOffset, outBytes.byteOffset + outBytes.byteLength)], {
        type: "application/pdf",
      }),
    };
  } catch {
    throw appError("IoError");
  }
}

export function downloadPdfBlob(blob: Blob, fileName: string): void {
  const blobUrl = URL.createObjectURL(blob);
  const downloadAnchor = document.createElement("a");
  downloadAnchor.href = blobUrl;
  downloadAnchor.download = fileName;
  downloadAnchor.click();
  URL.revokeObjectURL(blobUrl);
}
