/**
 * SHA-256 と (BANK, CARD) アドレス計算。
 * numberbank (xcx-numberbank) の computeHashes と互換であること:
 *   bank_key = SHA256(BANK), card_key = SHA256(CARD),
 *   docId    = SHA256(trim(BANK) + trim(CARD))
 * 本ライブラリは API 境界で BANK/CARD を trim してから渡すため、
 * trim 済み入力に対して numberbank と完全一致する。
 */

const encoder = new TextEncoder();

export async function sha256Hex(text: string): Promise<string> {
    const buf = await crypto.subtle.digest('SHA-256', encoder.encode(text));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export interface CardAddress {
    bank: string;
    card: string;
    bankKey: string;
    cardKey: string;
    docId: string;
}

/** BANK/CARD を trim し、numberbank 互換のハッシュ 3 点を計算する */
export async function cardAddress(bank: string, card: string): Promise<CardAddress> {
    const b = bank.trim();
    const c = card.trim();
    const [bankKey, cardKey, docId] = await Promise.all([
        sha256Hex(b),
        sha256Hex(c),
        sha256Hex(b + c)
    ]);
    return {bank: b, card: c, bankKey, cardKey, docId};
}

/** IDm 正規化: trim + 小文字化 (pasorich は 16 桁 hex を返す) */
export function normalizeIdm(s: string): string {
    return s.trim().toLowerCase();
}

export function isIdm(s: string): boolean {
    return /^[0-9a-f]{16}$/.test(s);
}

/**
 * numberbank の toFiniteNumber と同一: 文字列で保存された数値を正規化。
 * 変換できなければ fallback。
 */
export function toFiniteNumber(v: unknown, fallback = 0): number {
    if (v === '' || v === null || typeof v === 'undefined') return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}
