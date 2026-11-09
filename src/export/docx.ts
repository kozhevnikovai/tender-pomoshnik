// Черновики писем в Word: запрос на разъяснение и жалоба. Пометка «ЧЕРНОВИК» в каждом файле.
import { Document, Packer, Paragraph, TextRun } from "docx";

export async function draftDocx(text: string): Promise<Buffer> {
  const lines = text.split("\n");
  const doc = new Document({
    styles: { default: { document: { run: { font: "Times New Roman", size: 26 } } } },
    sections: [{
      children: lines.map((l, i) => new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun({ text: l, bold: i === 0 || /^(ЖАЛОБА|Запрос о даче)/.test(l), color: i === 0 ? "C8410F" : undefined })],
      })),
    }],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}
