/**
 * citizen-db の複合書込みシーケンス (docs/apps.md citizen-db 章)。
 * numberbank に複数キーの原子的更新はないため、失敗時は途中で止まる。
 * 呼び手はエラーをユーザーに見せ、再実行(冪等)で回復する。
 */
import {
    NbClient, KT, CITIZEN_NO_START,
    serializeRecord, tsNow, dateToday, normalizeIdm,
    writeLedger, ensureAccount,
    type CitizenProfile
} from '@kidstown/shared';

/** 市民番号を採番する (1001 から) */
export async function allocateCitizenNo(client: NbClient): Promise<string> {
    return String(await client.allocateNumber(KT.counterCitizenNo, CITIZEN_NO_START));
}

/**
 * プロフィール保存 (登録・編集共通の最小操作)。
 * 状態は kt.citizen.status (単一値アドレス、窓口 sb3 が書く方) にも同期して書く。
 * 表示時は kt.citizen.status 優先のため、両者は常にここで揃える。
 */
export async function saveProfile(client: NbClient, profile: CitizenProfile): Promise<void> {
    await client.put(KT.CITIZEN_PROFILE, profile.no, serializeRecord(profile));
    await client.put(KT.CITIZEN_STATUS, profile.no, profile.status);
}

/**
 * 市民登録 (プロフィール + IDm 紐付け + 口座開設 + init 明細)。
 * idm が空のときは紐付け・口座開設を行わない (後日「カード発行」で行う)。
 */
export async function registerCitizen(client: NbClient, profile: CitizenProfile): Promise<void> {
    await saveProfile(client, profile);
    if (profile.idm !== '') {
        await bindCard(client, profile.no, profile.idm);
    }
}

/** IDm 紐付け + 口座開設 + init 明細 (新規カード発行) */
export async function bindCard(client: NbClient, citizenNo: string, idmInput: string): Promise<void> {
    const idm = normalizeIdm(idmInput);
    await client.put(KT.CITIZEN_IDM, citizenNo, idm);
    await client.put(KT.CITIZEN_NO, idm, citizenNo);
    const opened = await ensureAccount(client, idm);
    if (opened) {
        await writeLedger(client, idm, {
            t: tsNow(), type: 'init', amount: 0, peer: 'cityhall', memo: `市民${citizenNo} 口座開設`
        });
    }
}

/**
 * IDm 差し替え (カード紛失・再発行)。
 * 1. 旧残高を新 IDm へ移し旧を 0 に
 * 2. 双方向紐付けを更新 (旧逆引きは空文字=無効)
 * 3. 新旧に adjust 明細
 * 4. プロフィール更新
 */
export async function reassignIdm(
    client: NbClient,
    profile: CitizenProfile,
    newIdmInput: string
): Promise<CitizenProfile> {
    const oldIdm = normalizeIdm(profile.idm);
    const newIdm = normalizeIdm(newIdmInput);
    const now = tsNow();

    let moved = 0;
    if (oldIdm !== '') {
        const oldBal = await client.get(KT.BALANCE, oldIdm);
        if (oldBal !== null) {
            moved = Number(oldBal) || 0;
            await client.put(KT.BALANCE, newIdm, moved);
            await client.put(KT.BALANCE, oldIdm, 0);
        }
    }
    if (moved === 0) await ensureAccount(client, newIdm);

    await client.put(KT.CITIZEN_IDM, profile.no, newIdm);
    await client.put(KT.CITIZEN_NO, newIdm, profile.no);
    if (oldIdm !== '') await client.put(KT.CITIZEN_NO, oldIdm, '');

    await writeLedger(client, newIdm, {
        t: now, type: 'adjust', amount: moved, balance: moved,
        peer: 'cityhall', memo: `カード再発行 (市民${profile.no}, 旧カードから残高移行)`
    });
    if (oldIdm !== '') {
        await writeLedger(client, oldIdm, {
            t: now, type: 'adjust', amount: -moved, balance: 0,
            peer: 'cityhall', memo: `カード再発行により無効化 (市民${profile.no})`
        });
    }

    const updated: CitizenProfile = {...profile, idm: newIdm};
    await saveProfile(client, updated);
    return updated;
}

/**
 * 市民の物理削除。プロフィール・紐付け・残高を消す (明細は履歴として残す)。
 * 原則は status=retired を推奨 (呼び手で確認済みであること)。
 */
export async function deleteCitizen(client: NbClient, profile: CitizenProfile): Promise<void> {
    const idm = normalizeIdm(profile.idm);
    if (idm !== '') {
        await client.remove(KT.BALANCE, idm);
        await client.remove(KT.CITIZEN_NO, idm);
    }
    await client.remove(KT.CITIZEN_IDM, profile.no);
    await client.remove(KT.CITIZEN_STATUS, profile.no);
    await client.remove(KT.CITIZEN_PROFILE, profile.no);
}

/** 新規登録フォームの初期値 */
export function emptyProfile(no = ''): CitizenProfile {
    return {no, idm: '', registered: dateToday(), status: 'active', note: ''};
}

export interface BulkGrantTarget {
    no: string;
    idm: string;
}

export interface BulkGrantResult {
    ok: number;
    failed: {no: string; message: string}[];
}

/**
 * 一斉お祝い金: 対象市民の口座へ順番に加算 + grant 明細を記帳する。
 * 1 人ずつ順次実行 (Scratch 側 onSnapshot への負荷配慮)。
 * 個別の失敗はスキップして続行し、失敗一覧を返す (成功済みへの二重送金を
 * 避けるため、失敗分は kids-bank の残高訂正等で個別に対応する)。
 */
export async function bulkGrant(
    client: NbClient,
    targets: BulkGrantTarget[],
    amount: number,
    memo: string,
    progress: (done: number, total: number) => void
): Promise<BulkGrantResult> {
    let ok = 0;
    const failed: BulkGrantResult['failed'] = [];
    for (const t of targets) {
        try {
            const balance = await client.change(KT.BALANCE, t.idm, amount);
            await writeLedger(client, t.idm, {
                t: tsNow(), type: 'grant', amount, balance,
                peer: 'cityhall', memo
            });
            ok++;
        } catch (err) {
            failed.push({no: t.no, message: err instanceof Error ? err.message : String(err)});
        }
        progress(ok + failed.length, targets.length);
    }
    return {ok, failed};
}
