import AdmZip from 'adm-zip';
import { extractDocumentFromBuffer } from './document-extractor.util';

describe('document-extractor.util', () => {
  it('extracts plain text and markdown', () => {
    const raw = 'Hello world! This is a test business document.';
    const res = extractDocumentFromBuffer(Buffer.from(raw, 'utf8'), 'sample.txt');
    expect(res.extractedText).toBe(raw);
    expect(res.charCount).toBe(raw.length);
  });

  it('extracts and formats CSV into a clean Markdown table', () => {
    const csv = 'Product,Price,Stock\nLaptop,$999,15\nMouse,$25,120';
    const res = extractDocumentFromBuffer(Buffer.from(csv, 'utf8'), 'products.csv');
    expect(res.extractedText).toContain('| Product | Price | Stock |');
    expect(res.extractedText).toContain('| Laptop | $999 | 15 |');
    expect(res.extractedText).toContain('| Mouse | $25 | 120 |');
  });

  it('extracts Word .docx document paragraphs', () => {
    const zip = new AdmZip();
    const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Company Policy &amp; Guidelines</w:t></w:r></w:p>
    <w:p><w:r><w:t>All refunds must be requested within 30 days of purchase.</w:t></w:r></w:p>
  </w:body>
</w:document>`;
    zip.addFile('word/document.xml', Buffer.from(docXml, 'utf8'));
    const docxBuf = zip.toBuffer();

    const res = extractDocumentFromBuffer(docxBuf, 'Policy.docx');
    expect(res.extractedText).toContain('Company Policy & Guidelines');
    expect(res.extractedText).toContain('All refunds must be requested within 30 days of purchase.');
  });

  it('extracts Excel .xlsx worksheets into tabular markdown', () => {
    const zip = new AdmZip();
    const sharedStringsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <si><t>Item</t></si>
  <si><t>Price</t></si>
  <si><t>Keyboard</t></si>
</sst>`;
    const sheet1Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1" t="s"><v>0</v></c>
      <c r="B1" t="s"><v>1</v></c>
    </row>
    <row r="2">
      <c r="A2" t="s"><v>2</v></c>
      <c r="B2"><v>45</v></c>
    </row>
  </sheetData>
</worksheet>`;

    zip.addFile('xl/sharedStrings.xml', Buffer.from(sharedStringsXml, 'utf8'));
    zip.addFile('xl/worksheets/sheet1.xml', Buffer.from(sheet1Xml, 'utf8'));
    const xlsxBuf = zip.toBuffer();

    const res = extractDocumentFromBuffer(xlsxBuf, 'Catalog.xlsx');
    expect(res.extractedText).toContain('| Item | Price |');
    expect(res.extractedText).toContain('| Keyboard | 45 |');
  });
});
