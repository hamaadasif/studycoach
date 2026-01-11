import * as pdfjsLib from "pdfjs-dist";

import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

(pdfjsLib as any).GlobalWorkerOptions.workerSrc = pdfWorker;

export async function extractTextFromUrl(url: string, contentType: string) {
  if (contentType === "text/plain" || url.toLowerCase().endsWith(".txt")) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch text (${res.status})`);
    return await res.text();
  }

  if (contentType === "application/pdf" || url.toLowerCase().endsWith(".pdf")) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch PDF (${res.status})`);

    const buf = await res.arrayBuffer();

    const pdf = await (pdfjsLib as any).getDocument({ data: buf }).promise;

    let out = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const strings = content.items
        .map((it: any) => it?.str)
        .filter((s: any) => typeof s === "string" && s.trim().length > 0);

      out += strings.join(" ") + "\n";
    }

    return out;
  }

  throw new Error("Extraction supports PDF and TXT for now.");
}
