import {useCallback, useEffect, useMemo, useState, type ReactNode} from 'react';
import {
    DataTable, Modal, useToast, useTown,
    KT, parseRecord, serializeRecord, formatTs, tsNow, normalizeIdm,
    downloadCsv, getBalance,
    type Column, type ShopProfile, type ShopTx, type TxItem, type CardRow
} from '@kidstown/shared';

interface TxRow {
    tx: ShopTx | null;
    raw: CardRow;
}

export interface ShopViewProps {
    shopId: string;
    profile: ShopProfile | null;
    onBack: () => void;
}

export function ShopView({shopId, profile, onBack}: ShopViewProps): ReactNode {
    const {client} = useTown();
    const toast = useToast();
    const [rows, setRows] = useState<TxRow[]>([]);
    const [balance, setBalance] = useState<number | null>(null);
    const [loading, setLoading] = useState(false);
    const [filter, setFilter] = useState('');
    const [editing, setEditing] = useState<TxRow | null>(null);
    const [adding, setAdding] = useState(false);

    const txBank = KT.shopTx(shopId);

    const reload = useCallback(async () => {
        setLoading(true);
        try {
            const [cards, bal] = await Promise.all([
                client.listCards(txBank),
                getBalance(client, KT.shopAccount(shopId))
            ]);
            const list: TxRow[] = cards.map(raw => ({raw, tx: parseRecord<ShopTx>(raw.value)}));
            list.sort((a, b) => (b.tx?.t ?? '').localeCompare(a.tx?.t ?? ''));
            setRows(list);
            setBalance(bal);
        } catch (err) {
            toast(`読み込みに失敗しました: ${err instanceof Error ? err.message : err}`, 'error');
        } finally {
            setLoading(false);
        }
    }, [client, txBank, shopId, toast]);

    useEffect(() => { void reload(); }, [reload]);

    const filtered = useMemo(() => rows.filter(r => {
        if (filter.trim() === '') return true;
        const q = filter.trim().toLowerCase();
        if (!r.tx) return String(r.raw.value).toLowerCase().includes(q);
        return r.tx.no.includes(q) ||
            r.tx.payer.toLowerCase().includes(q) ||
            r.tx.items.some(i => i.name.toLowerCase().includes(q));
    }), [rows, filter]);

    const itemsSummary = (tx: ShopTx): string =>
        tx.items.map(i => `${i.name}×${i.qty}`).join(', ');

    const remove = async (r: TxRow): Promise<void> => {
        if (!r.tx) {
            toast('壊れた取引は削除できません (Firestore コンソールから対応してください)', 'error');
            return;
        }
        if (!window.confirm(`取引 ${r.tx.no} を完全に削除します。通常は「取消 (void)」を推奨します。削除しますか?`)) return;
        if (!window.confirm('削除すると元に戻せません。本当によろしいですか?')) return;
        try {
            await client.remove(txBank, r.tx.no);
            toast(`取引 ${r.tx.no} を削除しました (残高は変わりません)`, 'success');
            await reload();
        } catch (err) {
            toast(`削除に失敗しました: ${err instanceof Error ? err.message : err}`, 'error');
        }
    };

    const columns: Column<TxRow>[] = [
        {key: 'no', label: '取引番号', render: r => r.tx?.no ?? '(不正)', sortValue: r => Number(r.tx?.no) || 0},
        {key: 't', label: '日時', render: r => formatTs(r.tx?.t), sortValue: r => r.tx?.t ?? ''},
        {
            key: 'items', label: '品目',
            render: r => r.tx ? itemsSummary(r.tx) : String(r.raw.value).slice(0, 40)
        },
        {
            key: 'qty', label: '個数', align: 'right',
            render: r => r.tx ? r.tx.items.reduce((s, i) => s + i.qty, 0) : '',
            sortValue: r => r.tx ? r.tx.items.reduce((s, i) => s + i.qty, 0) : 0
        },
        {key: 'total', label: '金額', align: 'right', render: r => r.tx?.total ?? '', sortValue: r => r.tx?.total ?? 0},
        {key: 'payer', label: '決済IDm', render: r => <span className="kt-mono">{r.tx?.payer ?? ''}</span>},
        {
            key: 'status', label: '状態',
            render: r => r.tx
                ? (r.tx.status === 'void'
                    ? <span className="kt-badge kt-badge-red">取消</span>
                    : <span className="kt-badge kt-badge-green">OK</span>)
                : <span className="kt-badge kt-badge-gray">raw</span>,
            sortValue: r => r.tx?.status ?? ''
        },
        {
            key: 'act', label: '', render: r => (
                <button className="kt-btn kt-btn-danger" onClick={e => { e.stopPropagation(); void remove(r); }}>削除</button>
            )
        }
    ];

    const exportCsv = (): void => {
        const out: (string | number)[][] = [
            ['日時', '取引番号', '店舗', '品名', '単価', '数量', '金額', '決済IDm', '状態']
        ];
        for (const r of filtered) {
            if (!r.tx) continue;
            for (const item of r.tx.items) {
                out.push([
                    r.tx.t, r.tx.no, r.tx.shop,
                    item.name, item.price, item.qty, item.price * item.qty,
                    r.tx.payer, r.tx.status
                ]);
            }
        }
        downloadCsv(`shop-${shopId}-tx.csv`, out);
    };

    const totalOk = filtered.reduce((s, r) => s + (r.tx?.status === 'ok' ? r.tx.total : 0), 0);

    return (
        <>
            <div className="kt-toolbar">
                <button className="kt-btn" onClick={onBack}>← お店一覧</button>
                <h2 style={{fontSize: 16}}>{profile?.name ?? ''} <span className="kt-hint">({shopId})</span></h2>
                <span className="kt-badge kt-badge-blue">店舗口座残高 {balance === null ? '未開設' : balance}</span>
                <span className="kt-badge kt-badge-gray">表示中の売上計 {totalOk}</span>
                <div className="kt-spacer" />
                <input
                    type="search" placeholder="番号・品名・IDmで検索"
                    value={filter} onChange={e => setFilter(e.target.value)}
                />
                <button className="kt-btn" onClick={() => void reload()} disabled={loading}>
                    {loading ? '読込中…' : '再読込'}
                </button>
                <button className="kt-btn" onClick={exportCsv}>CSV出力</button>
                <button className="kt-btn kt-btn-primary" onClick={() => setAdding(true)}>+ 取引を手入力</button>
            </div>

            <DataTable
                columns={columns}
                rows={filtered}
                rowKey={r => r.raw.docId}
                onRowClick={r => { if (r.tx) setEditing(r); }}
                emptyText={loading ? '読み込み中…' : '取引がありません'}
            />

            {(adding || editing?.tx) && (
                <TxFormModal
                    shopId={shopId}
                    tx={editing?.tx ?? null}
                    onClose={() => { setAdding(false); setEditing(null); }}
                    onDone={async () => { setAdding(false); setEditing(null); await reload(); }}
                />
            )}
        </>
    );
}

interface TxFormModalProps {
    shopId: string;
    /** null なら新規手入力 */
    tx: ShopTx | null;
    onClose: () => void;
    onDone: () => Promise<void>;
}

function TxFormModal({shopId, tx, onClose, onDone}: TxFormModalProps): ReactNode {
    const {client} = useTown();
    const toast = useToast();
    const isNew = tx === null;
    const [t, setT] = useState(tx?.t ?? tsNow());
    const [payer, setPayer] = useState(tx?.payer ?? '');
    const [status, setStatus] = useState<'ok' | 'void'>(tx?.status ?? 'ok');
    const [items, setItems] = useState<TxItem[]>(tx?.items?.length ? tx.items : [{name: '', price: 0, qty: 1}]);
    const [busy, setBusy] = useState(false);

    const total = items.reduce((s, i) => s + i.price * i.qty, 0);

    const setItem = (idx: number, patch: Partial<TxItem>): void => {
        setItems(prev => prev.map((it, i) => (i === idx ? {...it, ...patch} : it)));
    };

    const run = async (): Promise<void> => {
        const cleanItems = items
            .map(i => ({name: i.name.trim(), price: Number(i.price) || 0, qty: Number(i.qty) || 0}))
            .filter(i => i.name !== '');
        if (cleanItems.length === 0) {
            toast('品目を 1 つ以上入力してください', 'error');
            return;
        }
        if (!/^\d{14}$/.test(t.trim())) {
            toast('日時は YYYYMMDDHHMMSS (14桁) で入力してください', 'error');
            return;
        }
        setBusy(true);
        try {
            const no = isNew ? String(await client.allocateNumber(KT.counterShopTx(shopId))) : tx.no;
            const record: ShopTx = {
                no, t: t.trim(), shop: shopId,
                items: cleanItems,
                total: cleanItems.reduce((s, i) => s + i.price * i.qty, 0),
                payer: normalizeIdm(payer),
                status
            };
            await client.put(KT.shopTx(shopId), no, serializeRecord(record));
            toast(isNew
                ? `取引 ${no} を記録しました (残高は動きません。必要ならぎんこうアプリで訂正)`
                : `取引 ${no} を更新しました`, 'success');
            await onDone();
        } catch (err) {
            toast(`保存に失敗しました: ${err instanceof Error ? err.message : err}`, 'error');
            setBusy(false);
        }
    };

    return (
        <Modal
            title={isNew ? `取引の手入力 (${shopId})` : `取引 ${tx.no} の編集`}
            onClose={onClose}
            footer={
                <>
                    <button className="kt-btn" onClick={onClose} disabled={busy}>キャンセル</button>
                    <button className="kt-btn kt-btn-primary" onClick={() => void run()} disabled={busy}>
                        {busy ? '保存中…' : '保存'}
                    </button>
                </>
            }
        >
            <div className="kt-form">
                {isNew && (
                    <p className="kt-hint">
                        窓口障害時などの代替入力です。<b>口座残高は動きません</b>
                        (実際のお金の訂正はぎんこうアプリの「残高訂正」で行います)。
                    </p>
                )}
                <label>
                    売買日時 (YYYYMMDDHHMMSS)
                    <input value={t} onChange={e => setT(e.target.value)} />
                </label>
                <label>
                    決済カード IDm
                    <input className="kt-mono" value={payer} placeholder="16桁hex" onChange={e => setPayer(e.target.value)} />
                </label>
                <label>
                    状態
                    <select value={status} onChange={e => setStatus(e.target.value as 'ok' | 'void')}>
                        <option value="ok">OK</option>
                        <option value="void">取消 (void)</option>
                    </select>
                </label>
                <div>
                    <span style={{fontSize: 13, color: '#4a5568'}}>品目</span>
                    {items.map((item, idx) => (
                        <div key={idx} style={{display: 'flex', gap: 6, marginTop: 6}}>
                            <input
                                style={{flex: 2}} placeholder="品名" value={item.name}
                                onChange={e => setItem(idx, {name: e.target.value})}
                            />
                            <input
                                style={{flex: 1}} type="number" placeholder="単価" value={String(item.price)}
                                onChange={e => setItem(idx, {price: Number(e.target.value)})}
                            />
                            <input
                                style={{flex: 1}} type="number" placeholder="数量" value={String(item.qty)}
                                onChange={e => setItem(idx, {qty: Number(e.target.value)})}
                            />
                            <button
                                className="kt-btn" disabled={items.length === 1}
                                onClick={() => setItems(prev => prev.filter((_, i) => i !== idx))}
                            >−</button>
                        </div>
                    ))}
                    <button
                        className="kt-btn" style={{marginTop: 6}}
                        onClick={() => setItems(prev => [...prev, {name: '', price: 0, qty: 1}])}
                    >+ 品目を追加</button>
                </div>
                <p>合計: <b>{total}</b></p>
            </div>
        </Modal>
    );
}
