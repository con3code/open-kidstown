/**
 * 口座一覧の復元 (docs/apps.md kids-bank「口座一覧の実装注記」)。
 * kt.balance の CARD 平文はハッシュのみのため、
 * 市民プロフィール・店舗マスタ・明細バンク名から口座 ID 候補を集め、
 * card_key と突合して復元する。突合できない残りは「不明口座」。
 */
import {
    NbClient, KT, sha256Hex, parseRecord, toFiniteNumber,
    accountIdFromLedgerBank, shopIdFromAccount,
    type CitizenProfile, type ShopProfile
} from '@kidstown/shared';

export interface AccountInfo {
    /** 口座ID (IDm or shop.<店舗ID>)。不明口座は '' */
    id: string;
    kind: 'citizen' | 'shop' | 'other' | 'unknown';
    /** 市民口座のとき市民番号 */
    citizenNo?: string;
    /** 店舗口座のとき店名 */
    shopName?: string;
    balance: number;
    timeStamp: number;
    cardKey: string;
}

export async function loadAccounts(client: NbClient): Promise<AccountInfo[]> {
    const [profileRows, idmRows, shopRows, ledgerBanks, balanceRows] = await Promise.all([
        client.listCards(KT.CITIZEN_PROFILE),
        client.listCards(KT.CITIZEN_IDM),
        client.listCards(KT.SHOP_PROFILE),
        client.listBankNames(KT.LEDGER_PREFIX),
        client.listCards(KT.BALANCE)
    ]);

    // IDm は kt.citizen.idm (窓口 sb3 も書く単一値アドレス) を正とし、
    // profile JSON の idm はフォールバック (窓口でカード変更した直後のずれ対策)
    const idmOverrideByKey = new Map(idmRows.map(r => [r.cardKey, String(r.value ?? '')]));
    const idmToCitizen = new Map<string, string>();
    for (const row of profileRows) {
        const p = parseRecord<CitizenProfile>(row.value);
        if (!p?.no) continue;
        const override = idmOverrideByKey.get(await sha256Hex(p.no));
        const idm = override && override.trim() !== '' ? override.trim().toLowerCase() : p.idm;
        if (idm) idmToCitizen.set(idm, p.no);
    }
    const accountToShop = new Map<string, string>();
    for (const row of shopRows) {
        const s = parseRecord<ShopProfile>(row.value);
        if (s?.account) accountToShop.set(s.account, s.name);
    }

    const candidates = new Set<string>([
        ...idmToCitizen.keys(),
        ...accountToShop.keys()
    ]);
    for (const bankName of ledgerBanks) {
        const id = accountIdFromLedgerBank(bankName);
        if (id) candidates.add(id);
    }

    // 口座ID → card_key (SHA256(口座ID)) の対応表
    const keyToId = new Map<string, string>();
    await Promise.all([...candidates].map(async id => {
        keyToId.set(await sha256Hex(id), id);
    }));

    const accounts: AccountInfo[] = balanceRows.map(row => {
        const id = keyToId.get(row.cardKey) ?? '';
        const base = {
            id,
            balance: toFiniteNumber(row.value, 0),
            timeStamp: row.timeStamp,
            cardKey: row.cardKey
        };
        if (id === '') return {...base, kind: 'unknown' as const};
        if (idmToCitizen.has(id)) return {...base, kind: 'citizen' as const, citizenNo: idmToCitizen.get(id)};
        if (accountToShop.has(id)) return {...base, kind: 'shop' as const, shopName: accountToShop.get(id)};
        if (shopIdFromAccount(id)) return {...base, kind: 'shop' as const, shopName: `店舗 ${shopIdFromAccount(id)}`};
        return {...base, kind: 'other' as const};
    });

    accounts.sort((a, b) => {
        const kindOrder = {citizen: 0, shop: 1, other: 2, unknown: 3} as const;
        if (kindOrder[a.kind] !== kindOrder[b.kind]) return kindOrder[a.kind] - kindOrder[b.kind];
        return (a.citizenNo ?? a.id).localeCompare(b.citizenNo ?? b.id, 'ja', {numeric: true});
    });
    return accounts;
}

export const KIND_LABELS: Record<AccountInfo['kind'], string> = {
    citizen: '市民',
    shop: '店舗',
    other: 'その他',
    unknown: '不明'
};
