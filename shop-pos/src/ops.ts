/**
 * shop-pos の複合操作: お店の削除 (登録間違いの取り消し)。
 * 店舗にまつわる全データ (マスタ・口座・明細・取引・カウンタ) を一括で消す。
 */
import {KT, NbClient, toFiniteNumber} from '@kidstown/shared';

export interface ShopInspection {
    txCount: number;
    ledgerCount: number;
    /** null = 口座未開設 */
    balance: number | null;
    hasProfile: boolean;
}

/** 削除確認ダイアログ用に、店舗に紐づくデータ量を数える */
export async function inspectShop(client: NbClient, shopId: string): Promise<ShopInspection> {
    const account = KT.shopAccount(shopId);
    const [txRows, ledgerRows, balance, hasProfile] = await Promise.all([
        client.listCards(KT.shopTx(shopId)),
        client.listCards(KT.ledger(account)),
        client.get(KT.BALANCE, account),
        client.exists(KT.SHOP_PROFILE, shopId)
    ]);
    return {
        txCount: txRows.length,
        ledgerCount: ledgerRows.length,
        balance: balance === null ? null : toFiniteNumber(balance, 0),
        hasProfile
    };
}

export interface ShopDeleteResult {
    txDeleted: number;
    ledgerDeleted: number;
    claimsDeleted: number;
}

/**
 * お店を完全に削除する。消すもの:
 * - kt.shop.profile/<店舗ID> と 店舗口座 kt.balance/shop.<店舗ID>
 * - 取引 kt.shop.<店舗ID>.tx 全件 + 明細 kt.ledger.shop.<店舗ID> 全件
 * - 採番カウンタ (取引・明細連番)。カウンタを消すため kt.claim も全削除する
 *   (namespace.md §3.2 の警告への対応。claim は使い捨てで全削除しても無害)
 * - 動的バンクの bank ドキュメント (店舗一覧の発見元)
 * 失敗しても再実行で続きから回復できる (冪等)。
 */
export async function deleteShop(client: NbClient, shopId: string): Promise<ShopDeleteResult> {
    const account = KT.shopAccount(shopId);
    const txBank = KT.shopTx(shopId);
    const ledgerBank = KT.ledger(account);

    const txRows = await client.listCards(txBank);
    const txDeleted = await client.deleteDocs('card', txRows.map(r => r.docId));

    const ledgerRows = await client.listCards(ledgerBank);
    const ledgerDeleted = await client.deleteDocs('card', ledgerRows.map(r => r.docId));

    await client.remove(KT.BALANCE, account);
    await client.remove(KT.SHOP_PROFILE, shopId);
    await client.remove(KT.COUNTER, KT.counterShopTx(shopId));
    await client.remove(KT.COUNTER, KT.counterLedger(account));

    const claims = await client.listCards(KT.CLAIM);
    const claimsDeleted = await client.deleteDocs('card', claims.map(r => r.docId));

    // 動的バンクの bank ドキュメント (完全一致のみ削除)
    for (const bankName of [txBank, ledgerBank]) {
        const banks = await client.listBanks(bankName);
        await client.deleteDocs('bank', banks.filter(b => b.name === bankName).map(b => b.docId));
    }

    return {txDeleted, ledgerDeleted, claimsDeleted};
}
