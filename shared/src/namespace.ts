/**
 * kt.* 名前空間規約 v1 (docs/namespace.md) のアドレスビルダーと JSON 値スキーマ。
 * 全システム(Web 3 アプリ + Xcratch 窓口群)はこのモジュールの定義に従う。
 */

export const KT = {
    /** 口座残高 (CARD=口座ID, 値=数値文字列) */
    BALANCE: 'kt.balance',
    /** 市民番号→IDm (CARD=市民番号) */
    CITIZEN_IDM: 'kt.citizen.idm',
    /** IDm→市民番号 逆引き (CARD=IDm, 空文字=無効) */
    CITIZEN_NO: 'kt.citizen.no',
    /**
     * 市民の状態 (CARD=市民番号, 値=active|suspended|retired)。
     * profile JSON の status より優先される単一値アドレス。
     * Scratch 窓口が JSON を触らずに状態変更できるようにするための規約 v1.1 追加。
     */
    CITIZEN_STATUS: 'kt.citizen.status',
    /** 市民プロフィール (CARD=市民番号, 値=CitizenProfile JSON) */
    CITIZEN_PROFILE: 'kt.citizen.profile',
    /** 店舗マスタ (CARD=店舗ID, 値=ShopProfile JSON) */
    SHOP_PROFILE: 'kt.shop.profile',
    /** 採番カウンタ (CARD=カウンタ名, 値=最後に使った番号) */
    COUNTER: 'kt.counter',
    /** 採番クレーム (Scratch 用, CARD=<カウンタ名>.<番号>) */
    CLAIM: 'kt.claim',

    /** 店舗の売買取引バンク (CARD=取引番号, 値=ShopTx JSON) */
    shopTx: (shopId: string): string => `kt.shop.${shopId.trim()}.tx`,
    /** 入出金明細バンク (CARD=連番, 値=LedgerEntry JSON) */
    ledger: (accountId: string): string => `kt.ledger.${accountId.trim()}`,
    /** 店舗の口座ID (kt.balance / kt.ledger.* の CARD) */
    shopAccount: (shopId: string): string => `shop.${shopId.trim()}`,

    /** カウンタ名 */
    counterCitizenNo: 'citizen.no',
    counterShopTx: (shopId: string): string => `shop.${shopId.trim()}.tx`,
    counterLedger: (accountId: string): string => `ledger.${accountId.trim()}`,

    /** bank_name 前方一致列挙用プレフィックス */
    LEDGER_PREFIX: 'kt.ledger.',
    SHOP_PREFIX: 'kt.shop.'
} as const;

/** 市民番号カウンタの初期値 (最初の市民は 1001) */
export const CITIZEN_NO_START = 1000;

/** kt.ledger.<口座ID> のバンク名から口座IDを取り出す。該当しなければ null */
export function accountIdFromLedgerBank(bankName: string): string | null {
    return bankName.startsWith(KT.LEDGER_PREFIX) ? bankName.slice(KT.LEDGER_PREFIX.length) : null;
}

/** kt.shop.<店舗ID>.tx のバンク名から店舗IDを取り出す。該当しなければ null */
export function shopIdFromTxBank(bankName: string): string | null {
    const m = /^kt\.shop\.(.+)\.tx$/.exec(bankName);
    return m ? m[1] : null;
}

/** 口座IDが店舗口座 (shop.<店舗ID>) なら店舗IDを返す */
export function shopIdFromAccount(accountId: string): string | null {
    return accountId.startsWith('shop.') ? accountId.slice('shop.'.length) : null;
}

// ---------------------------------------------------------------- JSON スキーマ

export type CitizenStatus = 'active' | 'suspended' | 'retired';

export interface CitizenProfile {
    no: string;
    idm: string;
    registered: string; // YYYYMMDD
    status: CitizenStatus;
    note?: string;
}

export interface ShopProfile {
    id: string;
    name: string;
    account: string; // 常に shop.<店舗ID>
    note?: string;
}

export interface TxItem {
    name: string;
    price: number;
    qty: number;
}

export type TxStatus = 'ok' | 'void';

export interface ShopTx {
    no: string;
    t: string; // YYYYMMDDHHMMSS
    shop: string;
    items: TxItem[];
    total: number;
    payer: string; // 決済口座ID (買手IDm)
    status: TxStatus;
}

export type LedgerType =
    | 'init' | 'charge' | 'withdraw' | 'pay' | 'receive' | 'grant' | 'tax' | 'adjust';

export interface LedgerEntry {
    seq: string;
    t: string; // YYYYMMDDHHMMSS
    type: LedgerType;
    amount: number; // 入金 +, 出金 −
    balance?: number;
    peer?: string;
    memo?: string;
}

export const LEDGER_TYPE_LABELS: Record<LedgerType, string> = {
    init: '口座開設',
    charge: 'チャージ',
    withdraw: '引き出し',
    pay: '支払い',
    receive: '売上入金',
    grant: 'お祝い金',
    tax: '税金',
    adjust: '管理訂正'
};

export function isCitizenStatus(v: unknown): v is CitizenStatus {
    return v === 'active' || v === 'suspended' || v === 'retired';
}

export const CITIZEN_STATUS_LABELS: Record<CitizenStatus, string> = {
    active: '有効',
    suspended: '停止',
    retired: '抹消'
};

// ---------------------------------------------------------------- 値の parse / serialize

/**
 * number フィールドの生値を JSON としてパースする。
 * 壊れた値・JSON でない値は null (呼び手は raw 表示にフォールバック)。
 */
export function parseRecord<T>(raw: unknown): T | null {
    if (typeof raw !== 'string') return null;
    const s = raw.trim();
    if (!s.startsWith('{')) return null;
    try {
        const v = JSON.parse(s);
        return typeof v === 'object' && v !== null ? (v as T) : null;
    } catch {
        return null;
    }
}

/** 1 行 JSON 文字列にする (numberbank の number フィールドへ put する形) */
export function serializeRecord(value: object): string {
    return JSON.stringify(value);
}

// ---------------------------------------------------------------- 日時 (YYYYMMDDHHMMSS)

/** 現在時刻を 14 桁 YYYYMMDDHHMMSS に */
export function tsNow(date: Date = new Date()): string {
    const p = (n: number, w = 2): string => String(n).padStart(w, '0');
    return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}` +
        `${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

/** 今日を 8 桁 YYYYMMDD に */
export function dateToday(date: Date = new Date()): string {
    return tsNow(date).slice(0, 8);
}

/** 14 桁 / 8 桁日時を表示用に整形。形式外はそのまま返す */
export function formatTs(t: string | undefined): string {
    if (!t) return '';
    if (/^\d{14}$/.test(t)) {
        return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)} ${t.slice(8, 10)}:${t.slice(10, 12)}:${t.slice(12, 14)}`;
    }
    if (/^\d{8}$/.test(t)) {
        return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`;
    }
    return t;
}
