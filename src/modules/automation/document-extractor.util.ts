import AdmZip from 'adm-zip';
import * as zlib from 'zlib';

export interface ExtractedDocumentResult {
  filename: string;
  mimeType: string;
  extractedText: string;
  charCount: number;
  preview: string;
}

/**
 * Decodes XML entity references (&amp;, &lt;, &gt;, &quot;, &#39;, etc.)
 */
function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(Number(num)));
}

/**
 * Parses Word (.docx) document XML and returns formatted paragraphs and tables.
 */
function extractFromDocx(buffer: Buffer): string {
  try {
    const zip = new AdmZip(buffer);
    const docEntry = zip.getEntry('word/document.xml');
    if (!docEntry) {
      return '';
    }

    const xml = docEntry.getData().toString('utf8');
    const sections: string[] = [];

    const paragraphRegex = /<w:p\b[^>]*>(.*?)<\/w:p>/gs;
    let match: RegExpExecArray | null;

    while ((match = paragraphRegex.exec(xml)) !== null) {
      const paragraphXml = match[1];
      const textMatches = paragraphXml.match(/<w:t\b[^>]*>(.*?)<\/w:t>/gs) || [];
      const line = textMatches
        .map(tTag => tTag.replace(/<[^>]+>/g, ''))
        .join('')
        .trim();

      if (line) {
        sections.push(decodeXmlEntities(line));
      }
    }

    return sections.join('\n\n');
  } catch (err) {
    return `[Failed to extract Word document: ${err instanceof Error ? err.message : String(err)}]`;
  }
}

/**
 * Parses Excel (.xlsx) workbook and extracts sheets into Markdown tables.
 */
function extractFromXlsx(buffer: Buffer): string {
  try {
    const zip = new AdmZip(buffer);
    const sharedStringsEntry = zip.getEntry('xl/sharedStrings.xml');
    const sharedStrings: string[] = [];

    if (sharedStringsEntry) {
      const sstXml = sharedStringsEntry.getData().toString('utf8');
      const siRegex = /<si\b[^>]*>(.*?)<\/si>/gs;
      let siMatch: RegExpExecArray | null;
      while ((siMatch = siRegex.exec(sstXml)) !== null) {
        const tMatches = siMatch[1].match(/<t\b[^>]*>(.*?)<\/t>/gs) || [];
        const str = tMatches.map(t => t.replace(/<[^>]+>/g, '')).join('');
        sharedStrings.push(decodeXmlEntities(str));
      }
    }

    // Inspect worksheet entries
    const entries = zip.getEntries();
    const sheetEntries = entries.filter(
      e => e.entryName.startsWith('xl/worksheets/sheet') && e.entryName.endsWith('.xml'),
    );

    const sheetOutputs: string[] = [];

    for (const sheetEntry of sheetEntries) {
      const sheetXml = sheetEntry.getData().toString('utf8');
      const rowRegex = /<row\b[^>]*>(.*?)<\/row>/gs;
      const rows: string[][] = [];

      let rowMatch: RegExpExecArray | null;
      while ((rowMatch = rowRegex.exec(sheetXml)) !== null) {
        const rowXml = rowMatch[1];
        const cellRegex = /<c\b([^>]*)>(.*?)<\/c>/gs;
        const cellValues: string[] = [];

        let cellMatch: RegExpExecArray | null;
        while ((cellMatch = cellRegex.exec(rowXml)) !== null) {
          const attrs = cellMatch[1];
          const inner = cellMatch[2];
          const isSharedString = attrs.includes('t="s"');

          const vMatch = inner.match(/<v>(.*?)<\/v>/);
          if (vMatch) {
            const rawVal = vMatch[1].trim();
            if (isSharedString) {
              const idx = parseInt(rawVal, 10);
              cellValues.push(sharedStrings[idx] ?? rawVal);
            } else {
              cellValues.push(rawVal);
            }
          } else {
            const tMatch = inner.match(/<t\b[^>]*>(.*?)<\/t>/);
            if (tMatch) {
              cellValues.push(decodeXmlEntities(tMatch[1].replace(/<[^>]+>/g, '')));
            }
          }
        }

        if (cellValues.length > 0 && cellValues.some(v => v.trim().length > 0)) {
          rows.push(cellValues);
        }
      }

      if (rows.length > 0) {
        // Format as Markdown table
        const maxCols = Math.max(...rows.map(r => r.length));
        const normalizedRows = rows.map(r => {
          const padded = [...r];
          while (padded.length < maxCols) padded.push('');
          return padded;
        });

        const header = normalizedRows[0];
        const headerRow = `| ${header.join(' | ')} |`;
        const divider = `| ${header.map(() => '---').join(' | ')} |`;
        const dataRows = normalizedRows
          .slice(1)
          .map(r => `| ${r.join(' | ')} |`)
          .join('\n');

        sheetOutputs.push(`${headerRow}\n${divider}\n${dataRows}`);
      }
    }

    return sheetOutputs.join('\n\n');
  } catch (err) {
    return `[Failed to extract Excel workbook: ${err instanceof Error ? err.message : String(err)}]`;
  }
}

/**
 * Extracts plain text from a PDF buffer by decoding uncompressed and FlateDecode streams.
 */
function extractFromPdf(buffer: Buffer): string {
  try {
    const textChunks: string[] = [];
    const rawPdf = buffer.toString('latin1');

    // 1. Locate all streams in the PDF
    const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
    let match: RegExpExecArray | null;

    while ((match = streamRegex.exec(rawPdf)) !== null) {
      const rawStream = match[1];
      let streamData = rawStream;

      // Try zlib inflate if flate-decoded
      try {
        const streamBuf = Buffer.from(rawStream, 'latin1');
        const inflated = zlib.inflateSync(streamBuf);
        streamData = inflated.toString('latin1');
      } catch {
        // Not compressed or already raw
      }

      // Look for text operators: (string) Tj or [(str1) (str2)] TJ
      const tjRegex = /\(([^)]*)\)\s*Tj/g;
      let tjMatch: RegExpExecArray | null;
      while ((tjMatch = tjRegex.exec(streamData)) !== null) {
        const clean = tjMatch[1].replace(/\\([0-9]{3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)));
        if (clean.trim()) {
          textChunks.push(clean.trim());
        }
      }

      // Look for array TJ text: [(...) (...) ] TJ
      const tjArrayRegex = /\[(.*?)\]\s*TJ/g;
      let tjArrMatch: RegExpExecArray | null;
      while ((tjArrMatch = tjArrayRegex.exec(streamData)) !== null) {
        const inner = tjArrMatch[1];
        const innerParts = inner.match(/\(([^)]*)\)/g) || [];
        const combined = innerParts.map(p => p.slice(1, -1)).join('');
        if (combined.trim()) {
          textChunks.push(combined.trim());
        }
      }
    }

    if (textChunks.length > 0) {
      return textChunks.join(' ').replace(/\s{2,}/g, ' ');
    }

    // Fallback: extract any printable UTF-8 text sequences
    const printable = buffer
      .toString('utf8')
      .replace(/[^\x20-\x7E\r\n\t]/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();

    return printable.slice(0, 15000);
  } catch (err) {
    return `[Failed to extract PDF: ${err instanceof Error ? err.message : String(err)}]`;
  }
}

/**
 * Extracts plain text from CSV or TSV data.
 */
function extractFromCsv(text: string): string {
  const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length === 0) return '';

  const isTsv = lines[0].includes('\t');
  const delimiter = isTsv ? '\t' : ',';

  const rows = lines.map(line => {
    const cells: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === delimiter && !inQuotes) {
        cells.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    cells.push(current.trim());
    return cells;
  });

  const maxCols = Math.max(...rows.map(r => r.length));
  const normalized = rows.map(r => {
    const padded = [...r];
    while (padded.length < maxCols) padded.push('');
    return padded;
  });

  const header = normalized[0];
  const headerRow = `| ${header.join(' | ')} |`;
  const divider = `| ${header.map(() => '---').join(' | ')} |`;
  const dataRows = normalized
    .slice(1)
    .map(r => `| ${r.join(' | ')} |`)
    .join('\n');

  return `${headerRow}\n${divider}\n${dataRows}`;
}

/**
 * Main extractor function that detects document format and returns clean, structured text.
 */
export function extractDocumentFromBuffer(
  buffer: Buffer,
  filename: string,
  providedMimeType?: string,
): ExtractedDocumentResult {
  const lowerName = filename.toLowerCase();
  let extracted = '';
  let mimeType = providedMimeType || 'text/plain';

  if (lowerName.endsWith('.docx') || lowerName.endsWith('.doc')) {
    mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    extracted = extractFromDocx(buffer);
  } else if (lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls')) {
    mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    extracted = extractFromXlsx(buffer);
  } else if (lowerName.endsWith('.pdf')) {
    mimeType = 'application/pdf';
    extracted = extractFromPdf(buffer);
  } else if (lowerName.endsWith('.csv') || lowerName.endsWith('.tsv')) {
    mimeType = lowerName.endsWith('.tsv') ? 'text/tab-separated-values' : 'text/csv';
    extracted = extractFromCsv(buffer.toString('utf8'));
  } else {
    extracted = buffer.toString('utf8').trim();
    if (lowerName.endsWith('.json')) {
      mimeType = 'application/json';
      try {
        const parsed = JSON.parse(extracted);
        extracted = JSON.stringify(parsed, null, 2);
      } catch {
        // Keep raw string
      }
    }
  }

  const cleanedText = extracted.replace(/\r\n/g, '\n').trim();
  const preview = cleanedText.length > 300 ? `${cleanedText.slice(0, 300)}...` : cleanedText;

  return {
    filename,
    mimeType,
    extractedText: cleanedText,
    charCount: cleanedText.length,
    preview,
  };
}
