import {useCallback, useEffect, useState, type ReactNode} from 'react';
import {
    DataTable, Modal, useToast, useTown,
    KT, parseRecord, serializeRecord, formatTs, tsNow, toFiniteNumber,
    downloadCsv, writeLedger, getBalance,
    LEDGER_TYPE_LABELS,
    type Column, type LedgerEntry, type LedgerType, type CardRow
} from '@kidstown/shared';
import {KIND_LABELS, type AccountInfo} from './accounts';

interface LedgerRow {
    entry: LedgerEntry | null;
    raw: CardRow;
}

export interface AccountDetailProps {
    account: AccountInfo;
    onBack: () => void;
}

export function AccountDetail({account, onBack}: AccountDetailProps): ReactNode {
    const {client} = useTown();
    const toast = useToast();
    const [balance, setBalance] = useState<number | null>(account.balance);
    const [rows, setRows] = useState<LedgerRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [correcting, setCorrecting] = useState(false);
    const [manualEntry, setManualEntry] = useState(false);
    const [editing, setEditing] = useState<LedgerRow | null>(null);

    const reload = useCallback(async () => {
        setLoading(true);
        try {
            const [bal, cards] = await Promise.all([
                getBalance(client, account.id),
                client.listCards(KT.ledger(account.id))
            ]);
            setBalance(bal);
            const list: LedgerRow[] = cards.map(raw => ({raw, entry: parseRecord<LedgerEntry>(raw.value)}));
            list.sort((a, b) => {
                const sa = a.entry ? Number(a.entry.seq) || 0 : 0;
                const sb = b.entry ? Number(b.entry.seq) || 0 : 0;
                return sb - sa;
            });
            setRows(list);
        } catch (err) {
            toast(`読み込みに失敗しました: ${err instanceof Error ? err.message : err}`, 'error');
        } finally {
            setLoading(false);
        }
    }, [client, account.id, toast]);

    useEffect(() => { void reload(); }, [reload]);

    const remove = async (row: LedgerRow): Promise<void> => {
        const label = row.entry ? `明細 ${row.entry.seq}` : 'この明細';
        if (!window.confirm(`${label} を削除します。残高は変わりません。よろしいですか?`)) return;
        try {
            if (row.entry) {
                await client.remove(KT.ledger(account.id), row.entry.seq);
            } else {
                // 規約外レコードは docId 直指定できないため対象外
                toast('壊れた明細は削除できません (Firestore コンソールから対応してください)', 'error');
                return;
            }
            toast('明細を削除しました', 'success');
            await reload();
        } catch (err) {
            toast(`削除に失敗しました: ${err instanceof Error ? err.message : err}`, 'error');
        }
    };

    const columns: Column<LedgerRow>[] = [
        {key: 'seq', label: '連番', render: r => r.entry?.seq ?? '(不正)', sortValue: r => Number(r.entry?.seq) || 0},
        {key: 't', label: '日時', render: r => formatTs(r.entry?.t), sortValue: r => r.entry?.t ?? ''},
        {
            key: 'type', label: '種別',
            render: r => r.entry ? (LEDGER_TYPE_LABELS[r.entry.type] ?? r.entry.type) : String(r.raw.value).slice(0, 40),
            sortValue: r => r.entry?.type ?? ''
        },
        {
            key: 'amount', label: '増減', align: 'right',
            render: r => r.entry ? (r.entry.amount > 0 ? `+${r.entry.amount}` : String(r.entry.amount)) : '',
            sortValue: r => r.entry?.amount ?? 0
        },
        {key: 'balance', label: '記帳時残高', align: 'right', render: r => r.entry?.balance ?? ''},
        {key: 'peer', label: '相手', render: r => r.entry?.peer ?? ''},
        {key: 'memo', label: 'メモ', render: r => r.entry?.memo ?? ''},
        {
            key: 'act', label: '', render: r => (
                <button
                    className="kt-btn kt-btn-danger"
                    onClick={e => { e.stopPropagation(); void remove(r); }}
                >削除</button>
            )
        }
    ];

    const exportCsv = (): void => {
        downloadCsv(`ledger-${account.id}.csv`, [
            ['連番', '日時', '種別', '増減', '記帳時残高', '相手', 'メモ'],
            ...rows.filter(r => r.entry).map(r => {
                const e = r.entry as LedgerEntry;
                return [e.seq, e.t, e.type, e.amount, e.balance ?? '', e.peer ?? '', e.memo ?? ''];
            })
        ]);
    };

    const owner = account.kind === 'citizen' ? `市民 ${account.citizenNo}` : (account.shopName ?? KIND_LABELS[account.kind]);

    return (
        <>
            <div className="kt-toolbar">
                <button className="kt-btn" onClick={onBack}>← 口座一覧</button>
                <h2 style={{fontSize: 16}}>
                    <span className="kt-mono">{account.id}</span> ({owner})
                </h2>
                <span className="kt-badge kt-badge-blue">残高 {balance === null ? '未開設' : balance}</span>
                <div className="kt-spacer" />
                <button className="kt-btn" onClick={() => void reload()} disabled={loading}>
                    {loading ? '読込中…' : '再読込'}
                </button>
                <button className="kt-btn" onClick={exportCsv}>明細CSV</button>
                <button className="kt-btn" onClick={() => setManualEntry(true)}>+ 手動記帳</button>
                <button className="kt-btn kt-btn-primary" onClick={() => setCorrecting(true)}>残高訂正…</button>
            </div>

            <DataTable
                columns={columns}
                rows={rows}
                rowKey={r => r.raw.docId}
                onRowClick={r => { if (r.entry) setEditing(r); }}
                emptyText={loading ? '読み込み中…' : '明細がありません'}
            />

            {correcting && (
                <BalanceCorrectionModal
                    account={account}
                    currentBalance={balance}
                    onClose={() => setCorrecting(false)}
                    onDone={async () => { setCorrecting(false); await reload(); }}
                />
            )}
            {manualEntry && (
                <ManualEntryModal
                    account={account}
                    onClose={() => setManualEntry(false)}
                    onDone={async () => { setManualEntry(false); await reload(); }}
                />
            )}
            {editing?.entry && (
                <EditEntryModal
                    account={account}
                    entry={editing.entry}
                    onClose={() => setEditing(null)}
                    onDone={async () => { setEditing(null); await reload(); }}
                />
            )}
        </>
    );
}

interface BalanceCorrectionModalProps {
    account: AccountInfo;
    currentBalance: number | null;
    onClose: () => void;
    onDone: () => Promise<void>;
}

function BalanceCorrectionModal({account, currentBalance, onClose, onDone}: BalanceCorrectionModalProps): ReactNode {
    const {client} = useTown();
    const toast = useToast();
    const [value, setValue] = useState(String(currentBalance ?? 0));
    const [memo, setMemo] = useState('');
    const [busy, setBusy] = useState(false);

    const run = async (): Promise<void> => {
        const next = Number(value);
        if (!Number.isFinite(next)) {
            toast('残高は数値で入力してください', 'error');
            return;
        }
        if (memo.trim() === '') {
            toast('訂正理由 (メモ) は必須です', 'error');
            return;
        }
        if (next < 0 && !window.confirm('マイナス残高になります。よろしいですか?')) return;
        setBusy(true);
        try {
            const before = (await getBalance(client, account.id)) ?? 0;
            await client.put(KT.BALANCE, account.id, next);
            await writeLedger(client, account.id, {
                t: tsNow(), type: 'adjust', amount: next - before, balance: next,
                peer: 'bank', memo: memo.trim()
            });
            toast(`残高を ${before} → ${next} に訂正しました`, 'success');
            await onDone();
        } catch (err) {
            toast(`訂正に失敗しました: ${err instanceof Error ? err.message : err}`, 'error');
            setBusy(false);
        }
    };

    return (
        <Modal
            title={`残高訂正 (${account.id})`}
            onClose={onClose}
            footer={
                <>
                    <button className="kt-btn" onClick={onClose} disabled={busy}>キャンセル</button>
                    <button className="kt-btn kt-btn-primary" onClick={() => void run()} disabled={busy}>
                        {busy ? '処理中…' : '訂正する'}
                    </button>
                </>
            }
        >
            <div className="kt-form">
                <p className="kt-hint">新しい残高を直接指定します。差額が管理訂正 (adjust) として記帳されます。</p>
                <label>
                    新しい残高 (現在: {currentBalance ?? '未開設'})
                    <input type="number" autoFocus value={value} onChange={e => setValue(e.target.value)} />
                </label>
                <label>
                    訂正理由 (必須)
                    <input value={memo} placeholder="例: 決済失敗の復旧 (取引 12)" onChange={e => setMemo(e.target.value)} />
                </label>
            </div>
        </Modal>
    );
}

interface ManualEntryModalProps {
    account: AccountInfo;
    onClose: () => void;
    onDone: () => Promise<void>;
}

function ManualEntryModal({account, onClose, onDone}: ManualEntryModalProps): ReactNode {
    const {client} = useTown();
    const toast = useToast();
    const [type, setType] = useState<LedgerType>('adjust');
    const [amount, setAmount] = useState('0');
    const [peer, setPeer] = useState('bank');
    const [memo, setMemo] = useState('');
    const [applyBalance, setApplyBalance] = useState(false);
    const [busy, setBusy] = useState(false);

    const run = async (): Promise<void> => {
        const amt = Number(amount);
        if (!Number.isFinite(amt)) {
            toast('金額は数値で入力してください', 'error');
            return;
        }
        setBusy(true);
        try {
            let newBalance: number | undefined;
            if (applyBalance) newBalance = await client.change(KT.BALANCE, account.id, amt);
            await writeLedger(client, account.id, {
                t: tsNow(), type, amount: amt,
                ...(newBalance !== undefined ? {balance: newBalance} : {}),
                peer: peer.trim(), memo: memo.trim()
            });
            toast('記帳しました', 'success');
            await onDone();
        } catch (err) {
            toast(`記帳に失敗しました: ${err instanceof Error ? err.message : err}`, 'error');
            setBusy(false);
        }
    };

    return (
        <Modal
            title={`手動記帳 (${account.id})`}
            onClose={onClose}
            footer={
                <>
                    <button className="kt-btn" onClick={onClose} disabled={busy}>キャンセル</button>
                    <button className="kt-btn kt-btn-primary" onClick={() => void run()} disabled={busy}>
                        {busy ? '処理中…' : '記帳する'}
                    </button>
                </>
            }
        >
            <div className="kt-form">
                <label>
                    種別
                    <select value={type} onChange={e => setType(e.target.value as LedgerType)}>
                        {Object.entries(LEDGER_TYPE_LABELS).map(([k, label]) => (
                            <option key={k} value={k}>{label} ({k})</option>
                        ))}
                    </select>
                </label>
                <label>
                    金額 (入金 +, 出金 −)
                    <input type="number" value={amount} onChange={e => setAmount(e.target.value)} />
                </label>
                <label>
                    相手
                    <input value={peer} onChange={e => setPeer(e.target.value)} />
                </label>
                <label>
                    メモ
                    <input value={memo} onChange={e => setMemo(e.target.value)} />
                </label>
                <label className="kt-inline">
                    <input type="checkbox" checked={applyBalance} onChange={e => setApplyBalance(e.target.checked)} />
                    残高にも反映する (金額を加算)
                </label>
            </div>
        </Modal>
    );
}

interface EditEntryModalProps {
    account: AccountInfo;
    entry: LedgerEntry;
    onClose: () => void;
    onDone: () => Promise<void>;
}

function EditEntryModal({account, entry, onClose, onDone}: EditEntryModalProps): ReactNode {
    const {client} = useTown();
    const toast = useToast();
    const [form, setForm] = useState<LedgerEntry>(entry);
    const [busy, setBusy] = useState(false);

    const run = async (): Promise<void> => {
        const amt = toFiniteNumber(form.amount, NaN);
        if (Number.isNaN(amt)) {
            toast('金額は数値で入力してください', 'error');
            return;
        }
        setBusy(true);
        try {
            await client.put(
                KT.ledger(account.id), entry.seq,
                serializeRecord({...form, seq: entry.seq, amount: amt})
            );
            toast(`明細 ${entry.seq} を更新しました (残高は変わりません)`, 'success');
            await onDone();
        } catch (err) {
            toast(`更新に失敗しました: ${err instanceof Error ? err.message : err}`, 'error');
            setBusy(false);
        }
    };

    return (
        <Modal
            title={`明細 ${entry.seq} の編集 (${account.id})`}
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
                <p className="kt-hint">記帳ミスの訂正用です。残高は変わりません (残高を直すには「残高訂正」)。</p>
                <label>
                    日時 (YYYYMMDDHHMMSS)
                    <input value={form.t} onChange={e => setForm({...form, t: e.target.value})} />
                </label>
                <label>
                    種別
                    <select value={form.type} onChange={e => setForm({...form, type: e.target.value as LedgerType})}>
                        {Object.entries(LEDGER_TYPE_LABELS).map(([k, label]) => (
                            <option key={k} value={k}>{label} ({k})</option>
                        ))}
                    </select>
                </label>
                <label>
                    金額
                    <input type="number" value={String(form.amount)} onChange={e => setForm({...form, amount: Number(e.target.value)})} />
                </label>
                <label>
                    相手
                    <input value={form.peer ?? ''} onChange={e => setForm({...form, peer: e.target.value})} />
                </label>
                <label>
                    メモ
                    <input value={form.memo ?? ''} onChange={e => setForm({...form, memo: e.target.value})} />
                </label>
            </div>
        </Modal>
    );
}
