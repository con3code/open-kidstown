/**
 * 複数アプリで共通の業務操作 (docs/namespace.md の規約に沿った複合書込み)。
 */
import {toFiniteNumber} from './hash';
import type {NbClient} from './nbclient';
import {KT, serializeRecord, type LedgerEntry} from './namespace';

/**
 * 入出金明細を記帳する (連番採番 + put)。書いた明細の seq を返す。
 * 残高書込みとセットで呼ぶこと (残高だけの更新は「不明口座」を生む)。
 */
export async function writeLedger(
    client: NbClient,
    accountId: string,
    entry: Omit<LedgerEntry, 'seq'>
): Promise<string> {
    const seq = String(await client.allocateNumber(KT.counterLedger(accountId)));
    await client.put(KT.ledger(accountId), seq, serializeRecord({seq, ...entry}));
    return seq;
}

/** 口座残高を読む。未開設は null */
export async function getBalance(client: NbClient, accountId: string): Promise<number | null> {
    const v = await client.get(KT.BALANCE, accountId);
    return v === null ? null : toFiniteNumber(v, 0);
}

/** 口座が未開設なら残高 0 で開設する。開設したら true */
export async function ensureAccount(client: NbClient, accountId: string): Promise<boolean> {
    if (await client.exists(KT.BALANCE, accountId)) return false;
    await client.put(KT.BALANCE, accountId, 0);
    return true;
}
