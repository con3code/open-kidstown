import {useCallback, useEffect, useState, type ReactNode} from 'react';
import {
    AppShell, Modal, useToast, useTown,
    KT, parseRecord, serializeRecord, shopIdFromTxBank,
    ensureAccount, writeLedger, tsNow,
    type ShopProfile
} from '@kidstown/shared';
import {ShopView} from './ShopView';

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
                    </div>
                ))}
            </div>

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
