/**
 * kt-sys のメンテナンス操作 (docs/apps.md kt-sys 章)。
 * すべて「列挙 → 一括削除/一括put」の組み合わせで、対象は必ず
 * master_key (card) と kt.* プレフィックス (bank) にスコープする。
 */
import {
    NbClient, KT, parseRecord, tsNow, sha256Hex,
    writeLedger, getBalance, shopIdFromTxBank, accountIdFromLedgerBank,
    type CitizenProfile, type ShopProfile
} from '@kidstown/shared';

export const DUMP_FORMAT = 'kidstown-town-dump';
export const DUMP_VERSION = 1;

export type Progress = (message: string) => void;

// ---------------------------------------------------------------- 統計

export interface ShopTxStat {
    shopId: string;
    count: number;
}

export interface TownStats {
    totalCards: number;
    citizens: number;
    accounts: number;
    claims: number;
    counters: number;
    ledgerBanks: number;
    ledgerEntries: number;
    shopTx: ShopTxStat[];
}

export async function gatherStats(client: NbClient): Promise<TownStats> {
    const [all, profiles, shopProfiles, balances, claims, counters, ledgerBankNames, shopBankNames] =
        await Promise.all([
            client.listCardsByMaster(),
            client.listCards(KT.CITIZEN_PROFILE),
            client.listCards(KT.SHOP_PROFILE),
            client.listCards(KT.BALANCE),
            client.listCards(KT.CLAIM),
            client.listCards(KT.COUNTER),
            client.listBankNames(KT.LEDGER_PREFIX),
            client.listBankNames(KT.SHOP_PREFIX)
        ]);

    const shopIds = new Set<string>();
    for (const r of shopProfiles) {
        const p = parseRecord<ShopProfile>(r.value);
        if (p?.id) shopIds.add(p.id);
    }
    for (const name of shopBankNames) {
        const id = shopIdFromTxBank(name);
        if (id) shopIds.add(id);
    }
    const shopTx = await Promise.all([...shopIds].sort().map(async shopId => ({
        shopId,
        count: (await client.listCards(KT.shopTx(shopId))).length
    })));

    const ledgerCounts = await Promise.all(
        ledgerBankNames.map(async name => (await client.listCards(name)).length)
    );

    return {
        totalCards: all.length,
        citizens: profiles.length,
        accounts: balances.length,
        claims: claims.length,
        counters: counters.length,
        ledgerBanks: ledgerBankNames.length,
        ledgerEntries: ledgerCounts.reduce((s, n) => s + n, 0),
        shopTx
    };
}

// ---------------------------------------------------------------- 口座の列挙

export interface SysAccount {
    id: string;
    kind: 'citizen' | 'shop' | 'other';
}

/** 残高リセットの対象口座を列挙 (kids-bank と同じ復元ロジックの簡易版) */
export async function listAccounts(client: NbClient): Promise<SysAccount[]> {
    const [profiles, idmRows, shopProfiles, ledgerBankNames] = await Promise.all([
        client.listCards(KT.CITIZEN_PROFILE),
        client.listCards(KT.CITIZEN_IDM),
        client.listCards(KT.SHOP_PROFILE),
        client.listBankNames(KT.LEDGER_PREFIX)
    ]);

    const byId = new Map<string, SysAccount>();
    const idmOverrideByKey = new Map(idmRows.map(r => [r.cardKey, String(r.value ?? '')]));
    for (const row of profiles) {
        const p = parseRecord<CitizenProfile>(row.value);
        if (!p?.no) continue;
        const override = idmOverrideByKey.get(await sha256Hex(p.no));
        const idm = override && override.trim() !== '' ? override.trim().toLowerCase() : p.idm;
        if (idm) byId.set(idm, {id: idm, kind: 'citizen'});
    }
    for (const row of shopProfiles) {
        const p = parseRecord<ShopProfile>(row.value);
        if (p?.account) byId.set(p.account, {id: p.account, kind: 'shop'});
    }
    for (const name of ledgerBankNames) {
        const id = accountIdFromLedgerBank(name);
        if (!id || byId.has(id)) continue;
        byId.set(id, {id, kind: id.startsWith('shop.') ? 'shop' : 'other'});
    }
    return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------- リセット操作

/** claim 一括削除。運用中の採番を邪魔しないよう窓口停止中に行うこと */
export async function purgeClaims(client: NbClient): Promise<number> {
    const rows = await client.listCards(KT.CLAIM);
    return client.deleteDocs('card', rows.map(r => r.docId));
}

export interface BalanceResetResult {
    updated: number;
    ledgerDeleted: number;
}

/**
 * 口座残高の一括設定。
 * clearLedger=false: 差額を adjust 明細として記帳 (履歴が残る)
 * clearLedger=true : 明細と連番カウンタを消してから init 明細 1 件で初期化
 */
export async function resetBalances(
    client: NbClient,
    accounts: SysAccount[],
    amount: number,
    clearLedger: boolean,
    progress: Progress
): Promise<BalanceResetResult> {
    let updated = 0;
    let ledgerDeleted = 0;
    for (const a of accounts) {
        progress(`${a.id} (${updated + 1}/${accounts.length})`);
        if (clearLedger) {
            const rows = await client.listCards(KT.ledger(a.id));
            ledgerDeleted += await client.deleteDocs('card', rows.map(r => r.docId));
            await client.remove(KT.COUNTER, KT.counterLedger(a.id));
            await client.put(KT.BALANCE, a.id, amount);
            await writeLedger(client, a.id, {
                t: tsNow(), type: 'init', amount, balance: amount,
                peer: 'sys', memo: '一括リセット'
            });
        } else {
            const old = (await getBalance(client, a.id)) ?? 0;
            await client.put(KT.BALANCE, a.id, amount);
            await writeLedger(client, a.id, {
                t: tsNow(), type: 'adjust', amount: amount - old, balance: amount,
                peer: 'sys', memo: '残高一括設定'
            });
        }
        updated++;
    }
    return {updated, ledgerDeleted};
}

export interface ShopResetResult {
    txDeleted: number;
    claimsDeleted: number;
    accountReset: boolean;
}

/**
 * 店舗の売買取引リセット (取引レコード全削除 + 取引番号カウンタ削除 = 番号 1 から)。
 * カウンタを巻き戻すため、古い claim は必ず全削除する (namespace.md §3.2 の警告)。
 * claim は店舗ごとに選別できない (CARD がハッシュのため) が、全削除しても無害。
 */
export async function resetShopTx(
    client: NbClient,
    shopId: string,
    alsoAccount: boolean,
    progress: Progress
): Promise<ShopResetResult> {
    progress('取引レコードを削除中…');
    const rows = await client.listCards(KT.shopTx(shopId));
    const txDeleted = await client.deleteDocs('card', rows.map(r => r.docId));
    await client.remove(KT.COUNTER, KT.counterShopTx(shopId));
    progress('claim を掃除中…');
    const claimsDeleted = await purgeClaims(client);
    if (alsoAccount) {
        progress('店舗口座をリセット中…');
        await resetBalances(client, [{id: KT.shopAccount(shopId), kind: 'shop'}], 0, true, progress);
    }
    return {txDeleted, claimsDeleted, accountReset: alsoAccount};
}

export interface FullResetResult {
    cards: number;
    banks: number;
}

// ---------------------------------------------------------------- JSON 書き出し / 読み込み

/**
 * タウンダンプ形式 (ポータビリティ用)。
 * ドキュメント ID・bank_key・card_key は BANK/CARD 文字列のみから決まり
 * マスターキーに依存しないため、読み込み時に master_key フィールドを
 * 接続中のタウンのものへ書き換えるだけで、同一タウンへの復元も
 * 別マスターキー (新タウン) への移行も成立する。
 */
export interface TownDumpCard {
    id: string;
    number: unknown;
    bank_key: string;
    card_key: string;
    time_stamp: number;
}

export interface TownDumpBank {
    id: string;
    bank_name: string;
    time_stamp: number;
}

export interface TownDump {
    format: typeof DUMP_FORMAT;
    version: typeof DUMP_VERSION;
    exportedAt: string; // YYYYMMDDHHMMSS
    cards: TownDumpCard[];
    banks: TownDumpBank[];
}

/** タウン全体を JSON ダンプにする (このマスターキーの全 card + 参照される bank) */
export async function exportTown(client: NbClient): Promise<TownDump> {
    const [cards, allBanks] = await Promise.all([
        client.listCardsByMaster(),
        client.listBanks('')
    ]);
    // bank ドキュメントの id は SHA256(bank_name) = card の bank_key と同じ値。
    // 書き出す card が参照している bank だけを同梱する
    const referenced = new Set(cards.map(c => c.bankKey));
    const banks = allBanks.filter(b => referenced.has(b.docId));
    return {
        format: DUMP_FORMAT,
        version: DUMP_VERSION,
        exportedAt: tsNow(),
        cards: cards.map(c => ({
            id: c.docId, number: c.value,
            bank_key: c.bankKey, card_key: c.cardKey, time_stamp: c.timeStamp
        })),
        banks: banks.map(b => ({id: b.docId, bank_name: b.name, time_stamp: b.timeStamp}))
    };
}

/** ダンプファイルの検証つきパース。不正なら日本語メッセージの Error */
export function parseTownDump(text: string): TownDump {
    let obj: unknown;
    try {
        obj = JSON.parse(text);
    } catch {
        throw new Error('JSON として読めません');
    }
    const d = obj as TownDump;
    if (d?.format !== DUMP_FORMAT) throw new Error('タウンダンプのファイルではありません');
    if (d.version !== DUMP_VERSION) throw new Error(`未対応のバージョンです (${String(d.version)})`);
    if (!Array.isArray(d.cards) || !Array.isArray(d.banks)) throw new Error('中身が壊れています');
    for (const c of d.cards) {
        if (typeof c?.id !== 'string' || typeof c?.bank_key !== 'string' || typeof c?.card_key !== 'string') {
            throw new Error('card レコードが壊れています');
        }
    }
    for (const b of d.banks) {
        if (typeof b?.id !== 'string' || typeof b?.bank_name !== 'string') {
            throw new Error('bank レコードが壊れています');
        }
    }
    return d;
}

export interface ImportResult {
    cards: number;
    banks: number;
    deleted?: FullResetResult;
}

/**
 * タウンダンプの読み込み。
 * clean=true なら先にタウン全体を削除 (クリーンリストア)。
 * master_key は接続中のタウンのものへ書き換えて書き込む。
 */
export async function importTown(
    client: NbClient,
    dump: TownDump,
    clean: boolean,
    progress: Progress
): Promise<ImportResult> {
    let deleted: FullResetResult | undefined;
    if (clean) {
        deleted = await fullTownReset(client, progress);
    }
    progress(`bank ${dump.banks.length} 件を書き込み中…`);
    await client.setDocs('bank', dump.banks.map(b => ({
        id: b.id,
        data: {bank_name: b.bank_name, time_stamp: b.time_stamp || Date.now()}
    })));
    progress(`card ${dump.cards.length} 件を書き込み中…`);
    await client.setDocs('card', dump.cards.map(c => ({
        id: c.id,
        data: {
            number: c.number as string | number,
            bank_key: c.bank_key,
            card_key: c.card_key,
            master_key: client.masterKeySha256,
            time_stamp: c.time_stamp || Date.now()
        }
    })));
    return {cards: dump.cards.length, banks: dump.banks.length, deleted};
}

/**
 * タウン全体リセット。
 * - card: このマスターキーが書いた全ドキュメント (kt.* 以外の実験データ含む)
 * - bank: kt.* プレフィックスのもののみ (bank には master_key がないため名前空間で絞る)
 */
export async function fullTownReset(client: NbClient, progress: Progress): Promise<FullResetResult> {
    progress('カードを列挙中…');
    const cards = await client.listCardsByMaster();
    progress(`card ${cards.length} 件を削除中…`);
    await client.deleteDocs('card', cards.map(r => r.docId));
    progress('kt.* バンクを削除中…');
    const banks = await client.listBanks('kt.');
    await client.deleteDocs('bank', banks.map(b => b.docId));
    return {cards: cards.length, banks: banks.length};
}
