import { Router, Request, Response } from 'express';
import getRawBody from 'raw-body';

const router = Router();

// ─── Types ────────────────────────────────────────────────────────────────────
type Row = Record<string, unknown>;

// ─── Multipart parser ─────────────────────────────────────────────────────────
interface MultipartFile {
    filename: string;
    contentType: string;
    data: Buffer;
}

/**
 * Extracts the first file part from a multipart/form-data body.
 * Works with the raw Buffer from raw-body.
 */
function parseMultipart(body: Buffer, boundary: string): MultipartFile | null {
    const boundaryBuf = Buffer.from('--' + boundary);
    const crlf = Buffer.from('\r\n');

    // Split body on boundary markers
    let start = body.indexOf(boundaryBuf);
    if (start === -1) return null;

    start += boundaryBuf.length + crlf.length; // skip first boundary + CRLF

    const nextBoundary = body.indexOf(boundaryBuf, start);
    if (nextBoundary === -1) return null;

    const part = body.slice(start, nextBoundary - crlf.length); // trim trailing CRLF

    // Split headers from body
    const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'));
    if (headerEnd === -1) return null;

    const headers = part.slice(0, headerEnd).toString('utf8');
    const fileData = part.slice(headerEnd + 4); // skip \r\n\r\n

    // Extract filename
    const filenameMatch = headers.match(/filename="([^"]+)"/i);
    const filename = filenameMatch ? filenameMatch[1] : 'upload';

    // Extract content-type
    const ctMatch = headers.match(/Content-Type:\s*([^\r\n]+)/i);
    const contentType = ctMatch ? ctMatch[1].trim() : 'application/octet-stream';

    return { filename, contentType, data: fileData };
}

// ─── CSV parser ───────────────────────────────────────────────────────────────
function parseCsv(text: string): Row[] {
    const lines = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

    if (lines.length < 2) return [];

    const headers = splitCsvLine(lines[0]);

    return lines.slice(1).map((line) => {
        const values = splitCsvLine(line);
        const row: Row = {};
        headers.forEach((h, i) => {
            const raw = values[i] ?? '';
            row[h] = raw === '' ? null : raw;
        });
        return row;
    });
}

function splitCsvLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let insideQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
            insideQuotes = !insideQuotes;
        } else if (char === ',' && !insideQuotes) {
            result.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    result.push(current.trim());
    return result;
}

// ─── Excel (XLSX) parser ──────────────────────────────────────────────────────
/**
 * Minimal XLSX reader that extracts shared strings and the first sheet.
 * XLSX files are ZIP archives; we find the ZIP entries we need by scanning
 * the Central Directory at the end of the file.
 */
function parseXlsx(buf: Buffer): Row[] {
    // ---------- unzip helpers ----------
    const readUint16LE = (b: Buffer, o: number) => b[o] | (b[o + 1] << 8);
    const readUint32LE = (b: Buffer, o: number) =>
        (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

    // Find End of Central Directory signature (0x06054b50)
    let eocd = -1;
    for (let i = buf.length - 22; i >= 0; i--) {
        if (
            buf[i] === 0x50 && buf[i + 1] === 0x4b &&
            buf[i + 2] === 0x05 && buf[i + 3] === 0x06
        ) {
            eocd = i;
            break;
        }
    }
    if (eocd === -1) return [];

    const cdOffset = readUint32LE(buf, eocd + 16);
    const cdSize = readUint32LE(buf, eocd + 12);

    // Parse central directory entries
    const entries: Record<string, { localOffset: number }> = {};
    let pos = cdOffset;
    while (pos < cdOffset + cdSize) {
        if (
            buf[pos] !== 0x50 || buf[pos + 1] !== 0x4b ||
            buf[pos + 2] !== 0x01 || buf[pos + 3] !== 0x02
        ) break;

        const filenameLen = readUint16LE(buf, pos + 28);
        const extraLen = readUint16LE(buf, pos + 30);
        const commentLen = readUint16LE(buf, pos + 32);
        const localOffset = readUint32LE(buf, pos + 42);
        const name = buf.slice(pos + 46, pos + 46 + filenameLen).toString('utf8');
        entries[name] = { localOffset };
        pos += 46 + filenameLen + extraLen + commentLen;
    }

    // Read local file data (stored or deflate)
    function readEntry(name: string): Buffer | null {
        const entry = entries[name];
        if (!entry) return null;

        const lp = entry.localOffset;
        if (
            buf[lp] !== 0x50 || buf[lp + 1] !== 0x4b ||
            buf[lp + 2] !== 0x03 || buf[lp + 3] !== 0x04
        ) return null;

        const compression = readUint16LE(buf, lp + 8);
        const compSize = readUint32LE(buf, lp + 18);
        const fileNameLen = readUint16LE(buf, lp + 26);
        const extraLen = readUint16LE(buf, lp + 28);
        const dataStart = lp + 30 + fileNameLen + extraLen;
        const dataBuf = buf.slice(dataStart, dataStart + compSize);

        if (compression === 0) return dataBuf; // stored
        if (compression === 8) {
            // Deflate — use Node's built-in zlib
            const zlib = require('zlib');
            try {
                return zlib.inflateRawSync(dataBuf);
            } catch {
                return null;
            }
        }
        return null;
    }

    // Parse XML string
    function parseXml(xml: string): Record<string, string>[] {
        // Very minimal: extract <row> blocks, then <c> (cell) tags
        const rows: Record<string, string>[] = [];
        const rowRe = /<row[^>]*>([\s\S]*?)<\/row>/gi;
        let rowMatch;
        while ((rowMatch = rowRe.exec(xml)) !== null) {
            const rowXml = rowMatch[1];
            const cells: Record<string, string> = {};
            const cellRe = /<c\s+r="([A-Z]+)(\d+)"(?:[^>]*t="([^"]*)")?[^>]*>(?:[\s\S]*?<v>([\s\S]*?)<\/v>)?[\s\S]*?<\/c>/gi;
            let cellMatch;
            while ((cellMatch = cellRe.exec(rowXml)) !== null) {
                const col = cellMatch[1];
                const t = cellMatch[3] ?? '';      // type attribute
                const v = cellMatch[4] ?? '';      // value
                cells[col] = { t, v } as unknown as string;
            }
            rows.push(cells);
        }
        return rows;
    }

    // Shared strings
    let sharedStrings: string[] = [];
    const ssBuf = readEntry('xl/sharedStrings.xml');
    if (ssBuf) {
        const xml = ssBuf.toString('utf8');
        const siRe = /<si>[\s\S]*?<t(?:[^>]*)>([\s\S]*?)<\/t>[\s\S]*?<\/si>/gi;
        let m;
        while ((m = siRe.exec(xml)) !== null) {
            sharedStrings.push(m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
        }
    }

    // workbook.xml → find first sheet relationship
    const wbBuf = readEntry('xl/workbook.xml') ?? readEntry('xl/workbook.xml.rels');
    let sheetFile = 'xl/worksheets/sheet1.xml'; // default guess
    if (wbBuf) {
        const wbXml = wbBuf.toString('utf8');
        const sheetMatch = wbXml.match(/r:id="(rId\d+)"/);
        if (sheetMatch) {
            const relBuf = readEntry('xl/_rels/workbook.xml.rels');
            if (relBuf) {
                const relXml = relBuf.toString('utf8');
                const relMatch = relXml.match(
                    new RegExp(`Id="${sheetMatch[1]}"[^>]*Target="([^"]+)"`, 'i')
                );
                if (relMatch) {
                    const target = relMatch[1];
                    sheetFile = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
                }
            }
        }
    }

    const sheetBuf = readEntry(sheetFile);
    if (!sheetBuf) return [];

    const sheetXml = sheetBuf.toString('utf8');

    // Parse cell addresses
    function colIndex(col: string): number {
        let n = 0;
        for (const ch of col) n = n * 26 + ch.charCodeAt(0) - 64;
        return n - 1;
    }

    // Collect all cells
    const allCells: { row: number; col: number; val: string }[] = [];
    const cellRe = /<c\s+r="([A-Z]+)(\d+)"(?:[^>]*t="([^"]*)")?[^\/]*>(?:[\s\S]*?<v>([\s\S]*?)<\/v>)?[\s\S]*?<\/c>/gi;
    let cellMatch;
    while ((cellMatch = cellRe.exec(sheetXml)) !== null) {
        const colStr = cellMatch[1];
        const rowNum = parseInt(cellMatch[2], 10);
        const t = cellMatch[3] ?? '';
        let v = cellMatch[4] ?? '';
        if (t === 's') v = sharedStrings[parseInt(v, 10)] ?? v;
        allCells.push({ row: rowNum, col: colIndex(colStr), val: v });
    }

    if (allCells.length === 0) return [];

    const maxRow = Math.max(...allCells.map((c) => c.row));
    const maxCol = Math.max(...allCells.map((c) => c.col));

    // Build 2D grid
    const grid: (string | null)[][] = Array.from({ length: maxRow }, () =>
        Array(maxCol + 1).fill(null)
    );
    for (const c of allCells) {
        grid[c.row - 1][c.col] = c.val;
    }

    if (grid.length < 2) return [];
    const headers = grid[0].map((h, i) => (h ?? `col${i}`));
    return grid.slice(1).map((rowArr) => {
        const obj: Row = {};
        headers.forEach((h, i) => {
            const v = rowArr[i];
            obj[h] = v === null || v === '' ? null : v;
        });
        return obj;
    });
}

// ─── Dataset cleaner (follows pseudocode exactly) ─────────────────────────────
interface AnalysisResult {
    qualityScore: number;
    qualityLevel: string;
    warnings: string[];
    rowCount: number;
    columnCount: number;
    cleanedPreview: (string | number | null)[][];
}

function isNumericValue(v: unknown): boolean {
    if (v === null || v === undefined || v === '') return false;
    return !isNaN(Number(v));
}

function cleanAndAnalyze(rows: Row[]): AnalysisResult {
    const warnings: string[] = [];
    let qualityScore = 100;

    if (rows.length === 0) {
        return {
            qualityScore: 0,
            qualityLevel: 'Low Quality',
            warnings: ['Dataset is empty or could not be parsed'],
            rowCount: 0,
            columnCount: 0,
            cleanedPreview: [],
        };
    }

    // ── STEP 1: Data Profiling ────────────────────────────────────────────────
    const allKeys = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
    const totalCells = rows.length * allKeys.length;
    let totalMissing = 0;
    for (const row of rows) {
        for (const key of allKeys) {
            const v = row[key];
            if (v === null || v === undefined || v === '') totalMissing++;
        }
    }
    const missingPct = totalCells > 0 ? (totalMissing / totalCells) * 100 : 0;

    if (missingPct > 30) {
        warnings.push('High number of missing values detected');
        qualityScore -= 25;
    }

    // ── STEP 2: Select Numerical Columns ─────────────────────────────────────
    const numericKeys = allKeys.filter((key) => {
        const nonNullVals = rows.map((r) => r[key]).filter(
            (v) => v !== null && v !== undefined && v !== ''
        );
        return nonNullVals.length > 0 && nonNullVals.every((v) => isNumericValue(v));
    });

    const numericRatio = allKeys.length > 0 ? numericKeys.length / allKeys.length : 0;
    if (numericRatio < 0.3) {
        warnings.push('Dataset contains insufficient numerical data');
        qualityScore -= 20;
    }

    // ── STEP 3: Mean Imputation ───────────────────────────────────────────────
    const unusableColumns: string[] = [];
    const columnMeans: Record<string, number> = {};

    for (const key of numericKeys) {
        const validVals = rows
            .map((r) => r[key])
            .filter((v) => v !== null && v !== undefined && v !== '')
            .map(Number);

        if (validVals.length > 0) {
            columnMeans[key] = validVals.reduce((a, b) => a + b, 0) / validVals.length;
        } else {
            unusableColumns.push(key);
        }
    }

    // Apply imputation & drop unusable
    const workingKeys = numericKeys.filter((k) => !unusableColumns.includes(k));
    const cleanedRows = rows.map((row) => {
        const cleaned: Row = {};
        for (const key of workingKeys) {
            const v = row[key];
            cleaned[key] =
                v === null || v === undefined || v === ''
                    ? columnMeans[key]
                    : Number(v);
        }
        // Keep non-numeric columns too
        for (const key of allKeys) {
            if (!numericKeys.includes(key)) cleaned[key] = row[key];
        }
        return cleaned;
    });

    if (unusableColumns.length > 0) {
        warnings.push(
            `Columns removed due to complete missing values: ${unusableColumns.join(', ')}`
        );
        qualityScore -= 20;
    }

    // ── STEP 4: Post-Imputation Validation ───────────────────────────────────
    let remainingMissing = 0;
    for (const row of cleanedRows) {
        for (const key of workingKeys) {
            const v = row[key];
            if (v === null || v === undefined || (typeof v === 'number' && isNaN(v))) {
                remainingMissing++;
            }
        }
    }
    if (remainingMissing > 0) {
        warnings.push('Unresolved missing values remain after imputation');
        qualityScore -= 10;
    }

    // ── STEP 5: Quality Classification ───────────────────────────────────────
    qualityScore = Math.max(0, qualityScore);
    let qualityLevel: string;
    if (qualityScore < 50) qualityLevel = 'Low Quality';
    else if (qualityScore < 75) qualityLevel = 'Medium Quality';
    else qualityLevel = 'High Quality';

    // ── STEP 6: Build preview (first 6 rows incl. header) ────────────────────
    const finalKeys = Object.keys(cleanedRows[0] ?? {});
    const preview: (string | number | null)[][] = [
        finalKeys,
        ...cleanedRows.slice(0, 5).map((row) =>
            finalKeys.map((k) => {
                const v = row[k];
                if (v === null || v === undefined) return null;
                return v as string | number;
            })
        ),
    ];

    return {
        qualityScore,
        qualityLevel,
        warnings,
        rowCount: cleanedRows.length,
        columnCount: finalKeys.length,
        cleanedPreview: preview,
    };
}

// ─── POST /datasets/upload ────────────────────────────────────────────────────
router.post('/upload', async (req: Request, res: Response) => {
    const contentType = req.headers['content-type'] ?? '';

    if (!contentType.includes('multipart/form-data')) {
        res.status(400).json({ error: 'Request must be multipart/form-data' });
        return;
    }

    // Extract boundary
    const boundaryMatch = contentType.match(/boundary=([^\s;]+)/);
    if (!boundaryMatch) {
        res.status(400).json({ error: 'Missing multipart boundary' });
        return;
    }
    const boundary = boundaryMatch[1];

    // Read raw body
    let rawBody: Buffer;
    try {
        rawBody = await getRawBody(req, { limit: '50mb' });
    } catch (err) {
        res.status(413).json({ error: 'File too large or could not be read' });
        return;
    }

    const file = parseMultipart(rawBody, boundary);
    if (!file) {
        res.status(400).json({ error: 'No file found in request' });
        return;
    }

    const ext = file.filename.split('.').pop()?.toLowerCase() ?? '';
    let rows: Row[];

    try {
        if (ext === 'csv' || file.contentType.includes('csv') || file.contentType.includes('text/plain')) {
            rows = parseCsv(file.data.toString('utf8'));
        } else if (ext === 'json' || file.contentType.includes('json')) {
            const parsed = JSON.parse(file.data.toString('utf8'));
            if (Array.isArray(parsed)) {
                rows = parsed as Row[];
            } else if (typeof parsed === 'object' && parsed !== null) {
                // Handle { data: [...] } or similar wrapping
                const candidate = Object.values(parsed).find(Array.isArray);
                rows = (candidate as Row[]) ?? [parsed as Row];
            } else {
                res.status(422).json({ error: 'JSON must contain an array of objects' });
                return;
            }
        } else if (ext === 'xlsx' || ext === 'xls' || file.contentType.includes('spreadsheet')) {
            rows = parseXlsx(file.data);
            if (rows.length === 0) {
                res.status(422).json({ error: 'Could not parse Excel file' });
                return;
            }
        } else {
            res.status(415).json({
                error: `Unsupported file type "${ext}". Please upload CSV, JSON, or Excel.`,
            });
            return;
        }
    } catch (err) {
        console.error('Parse error:', err);
        res.status(422).json({ error: 'Failed to parse file: ' + (err as Error).message });
        return;
    }

    const result = cleanAndAnalyze(rows);
    res.status(200).json({ ...result, _rows: rows });
});

export default router;
