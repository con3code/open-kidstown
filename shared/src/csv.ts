/**
 * CSV 入出力 (RFC 4180 準拠)。
 * エクスポートは UTF-8 BOM 付き (Excel 対応)。
 */

export type CsvCell = string | number | null | undefined;

function escapeCell(cell: CsvCell): string {
    const s = cell === null || cell === undefined ? '' : String(cell);
    if (/[",\r\n]/.test(s)) {
        return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
}

export function toCsv(rows: CsvCell[][]): string {
    return rows.map(row => row.map(escapeCell).join(',')).join('\r\n') + '\r\n';
}

/** RFC 4180 パーサ (quote / 改行 / カンマ / BOM 対応) */
export function parseCsv(text: string): string[][] {
    const src = text.replace(/^\uFEFF/, '');
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = '';
    let inQuotes = false;
    let i = 0;
    const pushCell = (): void => { row.push(cell); cell = ''; };
    const pushRow = (): void => { pushCell(); rows.push(row); row = []; };
    while (i < src.length) {
        const ch = src[i];
        if (inQuotes) {
            if (ch === '"') {
                if (src[i + 1] === '"') { cell += '"'; i += 2; continue; }
                inQuotes = false; i++; continue;
            }
            cell += ch; i++; continue;
        }
        if (ch === '"' && cell === '') { inQuotes = true; i++; continue; }
        if (ch === ',') { pushCell(); i++; continue; }
        if (ch === '\r') { if (src[i + 1] === '\n') i++; pushRow(); i++; continue; }
        if (ch === '\n') { pushRow(); i++; continue; }
        cell += ch; i++;
    }
    if (cell !== '' || row.length > 0) pushRow();
    // 末尾の完全空行を除去
    while (rows.length > 0 && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') {
        rows.pop();
    }
    return rows;
}

/** ブラウザで CSV をダウンロードさせる */
export function downloadCsv(filename: string, rows: CsvCell[][]): void {
    const blob = new Blob(['\uFEFF' + toCsv(rows)], {type: 'text/csv;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** <input type="file"> で選ばれた CSV ファイルを読む */
export function readCsvFile(file: File): Promise<string[][]> {
    return file.text().then(parseCsv);
}
