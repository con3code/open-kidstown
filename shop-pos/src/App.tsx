import {useCallback, useEffect, useState, type ReactNode} from 'react';
import {
    AppShell, Modal, useToast, useTown,
    KT, parseRecord, serializeRecord, shopIdFromTxBank,
    ensureAccount, writeLedger, tsNow,
    type ShopProfile
} from '@kidstown/shared';
import {ShopView} from './ShopView';
import {inspectShop, deleteShop, type ShopInspection} from './ops';

interface ShopListItem {
    id: string;
    profile: ShopProfile | null;
}

export function App(): ReactNode {
    const {client} = useTown();
    const toast = useToast();
    const [shops, setShops] = useState<ShopListItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [selected, setSelected] = useState<ShopListItem | null>(null);
    const [adding, setAdding] = useState(false);
    const [deleting, setDeleting] = useState<ShopListItem | null>(null);

    const reload = useCallback(async () => {
        setLoading(true);
        try {
            const [profileRows, shopBanks] = await Promise.all([
                client.listCards(KT.SHOP_PROFILE),
                client.listBankNames(KT.SHOP_PREFIX)
            ]);
            const byId = new Map<string, ShopListItem>();
            for (const row of profileRows) {
                const p = parseRecord<ShopProfile>(row.value);
                if (p?.id) byId.set(p.id, {id: p.id, profile: p});
            }
            // マスタ未登録でも取引バンクがあれば一覧に出す (Xcratch 側が先行した場合)
            for (const bankName of shopBanks) {
                const id = shopIdFromTxBank(bankName);
                if (id && !byId.has(id)) byId.set(id, {id, profile: null});
            }
            setShops([...byId.values()].sort((a, b) => a.id.localeCompare(b.id, 'ja', {numeric: true})));
        } catch (err) {
            toast(`読み込みに失敗しました: ${err instanceof Error ? err.message : err}`, 'error');
        } finally {
            setLoading(false);
        }
    }, [client, toast]);

    useEffect(() => { void reload(); }, [reload]);

    if (selected) {
        return (
            <AppShell appName="キッズタウンお店POS" accentColor="#b7791f">
                <ShopView
                    shopId={selected.id}
                    profile={selected.profile}
                    onBack={() => { setSelected(null); void reload(); }}
                />
            </AppShell>
        );
    }

    return (
        <AppShell appName="キッズタウンお店POS" accentColor="#b7791f">
            <div className="kt-toolbar">
                <h2 style={{fontSize: 16}}>お店をえらぶ</h2>
                <div className="kt-spacer" />
                <button className="kt-btn" onClick={() => void reload()} disabled={loading}>
                    {loading ? '読込中…' : '再読込'}
                </button>
                <button className="kt-btn kt-btn-primary" onClick={() => setAdding(true)}>+ お店を登録</button>
            </div>

            {shops.length === 0 && (
                <p className="kt-hint">{loading ? '読み込み中…' : 'お店が登録されていません。「+ お店を登録」から始めてください。'}</p>
            )}
            <div className="kt-cards">
                {shops.map(s => (
                    <div key={s.id} className="kt-card" onClick={() => setSelected(s)}>
                        <h3>{s.profile?.name ?? `(マスタ未登録)`}</h3>
                        <p>店舗ID: {s.id}</p>
                        {s.profile?.note && <p>{s.profile.note}</p>}
                        <p style={{textAlign: 'right', marginTop: 8}}>
                            <button
                                className="kt-btn kt-btn-danger"
                                onClick={e => { e.stopPropagation(); setDeleting(s); }}
                            >削除…</button>
                        </p>
                    </div>
                ))}
            </div>

            {deleting && (
                <DeleteShopModal
                    shop={deleting}
                    onClose={() => setDeleting(null)}
                    onDone={async () => { setDeleting(null); await reload(); }}
                />
            )}

            {adding && (
                <AddShopModal
                    existingIds={shops.map(s => s.id)}
                    onClose={() => setAdding(false)}
                    onDone={async () => { setAdding(false); await reload(); }}
                />
            )}
        </AppShell>
    );
}

interface DeleteShopModalProps {
    shop: ShopListItem;
    onClose: () => void;
    onDone: () => Promise<void>;
}

function DeleteShopModal({shop, onClose, onDone}: DeleteShopModalProps): ReactNode {
    const {client} = useTown();
    const toast = useToast();
    const [info, setInfo] = useState<ShopInspection | null>(null);
    const [typed, setTyped] = useState('');
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        inspectShop(client, shop.id).then(setInfo).catch(err => {
            toast(`確認に失敗しました: ${err instanceof Error ? err.message : err}`, 'error');
        });
    }, [client, shop.id, toast]);

    // 取引や残高が残っている店は、店舗IDのタイプ入力を要求する
    const heavy = info !== null && (info.txCount > 0 || (info.balance ?? 0) !== 0);
    const ready = info !== null && (!heavy || typed.trim() === shop.id);

    const run = async (): Promise<void> => {
        setBusy(true);
        try {
            const r = await deleteShop(client, shop.id);
            toast(`お店 ${shop.id} を削除しました (取引 ${r.txDeleted} 件 / 明細 ${r.ledgerDeleted} 件も削除)`, 'success');
            await onDone();
        } catch (err) {
            toast(`削除に失敗しました: ${err instanceof Error ? err.message : err}。再実行で続きから回復できます`, 'error');
            setBusy(false);
        }
    };

    return (
        <Modal
            title={`お店 ${shop.id} の削除`}
            onClose={onClose}
            footer={
                <>
                    <button className="kt-btn" onClick={onClose} disabled={busy}>キャンセル</button>
                    <button className="kt-btn kt-btn-danger" disabled={busy || !ready} onClick={() => void run()}>
                        {busy ? '削除中…' : info === null ? '確認中…' : `お店 ${shop.id} を削除する`}
                    </button>
                </>
            }
        >
            <div className="kt-form">
                <p>
                    {shop.profile?.name ? `「${shop.profile.name}」` : `店舗 ${shop.id}`} に関する
                    データをすべて削除します。<b>元に戻せません。</b>
                </p>
                {info === null ? (
                    <p className="kt-hint">データ量を確認しています…</p>
                ) : (
                    <p className="kt-hint">
                        消えるもの: 店舗マスタ / 店舗口座
                        (残高 {info.balance === null ? '未開設' : `${info.balance} えん`}) /
                        取引 {info.txCount} 件 / 明細 {info.ledgerCount} 件 / 採番カウンタ
                    </p>
                )}
                {heavy && (
                    <>
                        <p style={{color: '#c53030', margin: 0}}>
                            取引または残高が残っています。登録直後の取り消しでない場合は、
                            先に お店POS・ぎんこう Web で記録の確認 (CSV 出力) をおすすめします。
                        </p>
                        <label>
                            確認のため店舗ID「{shop.id}」を入力してください
                            <input autoFocus value={typed} disabled={busy}
                                placeholder={shop.id} onChange={e => setTyped(e.target.value)} />
                        </label>
                    </>
                )}
            </div>
        </Modal>
    );
}

interface AddShopModalProps {
    existingIds: string[];
    onClose: () => void;
    onDone: () => Promise<void>;
}

function AddShopModal({existingIds, onClose, onDone}: AddShopModalProps): ReactNode {
    const {client} = useTown();
    const toast = useToast();
    const [id, setId] = useState('');
    const [name, setName] = useState('');
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);

    const run = async (): Promise<void> => {
        const shopId = id.trim();
        if (!/^[0-9A-Za-z_-]+$/.test(shopId)) {
            toast('店舗IDは英数字 (と - _) で入力してください (例: B06)', 'error');
            return;
        }
        if (existingIds.includes(shopId) &&
            !window.confirm(`店舗 ${shopId} は既に存在します。マスタを上書きしますか?`)) {
            return;
        }
        if (name.trim() === '') {
            toast('店名を入力してください', 'error');
            return;
        }
        setBusy(true);
        try {
            const account = KT.shopAccount(shopId);
            const profile: ShopProfile = {id: shopId, name: name.trim(), account, note: note.trim()};
            await client.put(KT.SHOP_PROFILE, shopId, serializeRecord(profile));
            const opened = await ensureAccount(client, account);
            if (opened) {
                await writeLedger(client, account, {
                    t: tsNow(), type: 'init', amount: 0, peer: 'cityhall', memo: `店舗${shopId} 口座開設`
                });
            }
            toast(`お店 ${shopId} を登録しました (口座 ${account})`, 'success');
            await onDone();
        } catch (err) {
            toast(`登録に失敗しました: ${err instanceof Error ? err.message : err}`, 'error');
            setBusy(false);
        }
    };

    return (
        <Modal
            title="お店を登録"
            onClose={onClose}
            footer={
                <>
                    <button className="kt-btn" onClick={onClose} disabled={busy}>キャンセル</button>
                    <button className="kt-btn kt-btn-primary" onClick={() => void run()} disabled={busy}>
                        {busy ? '登録中…' : '登録'}
                    </button>
                </>
            }
        >
            <div className="kt-form">
                <label>
                    店舗ID (例: B06)
                    <input autoFocus value={id} onChange={e => setId(e.target.value)} />
                </label>
                <label>
                    店名
                    <input value={name} onChange={e => setName(e.target.value)} />
                </label>
                <label>
                    メモ
                    <input value={note} onChange={e => setNote(e.target.value)} />
                </label>
                <p className="kt-hint">登録すると店舗口座 (shop.店舗ID) が残高 0 で開設されます。</p>
            </div>
        </Modal>
    );
}
