import {useCallback, useEffect, useMemo, useState, type ReactNode} from 'react';
import {
    AppShell, DataTable, useToast, useTown,
    KT, parseRecord, downloadCsv,
    type Column, type LedgerEntry
} from '@kidstown/shared';
import {loadAccounts, KIND_LABELS, type AccountInfo} from './accounts';
import {AccountDetail} from './AccountDetail';

export function App(): ReactNode {
    const {client} = useTown();
    const toast = useToast();
    const [accounts, setAccounts] = useState<AccountInfo[]>([]);
    const [loading, setLoading] = useState(false);
    const [filter, setFilter] = useState('');
    const [selected, setSelected] = useState<AccountInfo | null>(null);

    const reload = useCallback(async () => {
        setLoading(true);
        try {
            setAccounts(await loadAccounts(client));
        } catch (err) {
            toast(`読み込みに失敗しました: ${err instanceof Error ? err.message : err}`, 'error');
        } finally {
            setLoading(false);
        }
    }, [client, toast]);

    useEffect(() => { void reload(); }, [reload]);

    const filtered = useMemo(() => accounts.filter(a => {
        if (filter.trim() === '') return true;
        const q = filter.trim().toLowerCase();
        return a.id.toLowerCase().includes(q) ||
            (a.citizenNo ?? '').toLowerCase().includes(q) ||
            (a.shopName ?? '').toLowerCase().includes(q);
    }), [accounts, filter]);

    const kindBadge = (a: AccountInfo): ReactNode => {
        const cls = {citizen: 'kt-badge-green', shop: 'kt-badge-blue', other: 'kt-badge-gray', unknown: 'kt-badge-red'}[a.kind];
        return <span className={`kt-badge ${cls}`}>{KIND_LABELS[a.kind]}</span>;
    };

    const columns: Column<AccountInfo>[] = [
        {
            key: 'id', label: '口座ID',
            render: a => <span className="kt-mono">{a.id || `(不明 ${a.cardKey.slice(0, 12)}…)`}</span>,
            sortValue: a => a.id
        },
        {key: 'kind', label: '種別', render: kindBadge, sortValue: a => a.kind},
        {
            key: 'owner', label: '持ち主',
            render: a => a.kind === 'citizen' ? `市民 ${a.citizenNo}` : (a.shopName ?? ''),
            sortValue: a => a.citizenNo ?? a.shopName ?? ''
        },
        {key: 'balance', label: '残高', align: 'right', render: a => String(a.balance), sortValue: a => a.balance},
        {
            key: 'ts', label: '最終更新',
            render: a => a.timeStamp ? new Date(a.timeStamp).toLocaleString('ja-JP') : '',
            sortValue: a => a.timeStamp
        }
    ];

    const exportAccounts = (): void => {
        downloadCsv('accounts.csv', [
            ['口座ID', '種別', '持ち主', '残高', '最終更新'],
            ...filtered.map(a => [
                a.id || `unknown:${a.cardKey}`,
                KIND_LABELS[a.kind],
                a.kind === 'citizen' ? `市民 ${a.citizenNo}` : (a.shopName ?? ''),
                a.balance,
                a.timeStamp ? new Date(a.timeStamp).toLocaleString('ja-JP') : ''
            ])
        ]);
    };

    const exportAllLedgers = async (): Promise<void> => {
        try {
            const rows: (string | number)[][] = [['口座ID', '連番', '日時', '種別', '増減', '残高', '相手', 'メモ']];
            for (const a of accounts) {
                if (a.id === '') continue;
                const cards = await client.listCards(KT.ledger(a.id));
                const entries = cards
                    .map(c => parseRecord<LedgerEntry>(c.value))
                    .filter((e): e is LedgerEntry => e !== null)
                    .sort((x, y) => (Number(x.seq) || 0) - (Number(y.seq) || 0));
                for (const e of entries) {
                    rows.push([a.id, e.seq, e.t, e.type, e.amount, e.balance ?? '', e.peer ?? '', e.memo ?? '']);
                }
            }
            downloadCsv('ledgers-all.csv', rows);
        } catch (err) {
            toast(`明細の取得に失敗しました: ${err instanceof Error ? err.message : err}`, 'error');
        }
    };

    if (selected) {
        return (
            <AppShell appName="キッズタウンぎんこう" accentColor="#2b6cb0">
                <AccountDetail
                    account={selected}
                    onBack={() => { setSelected(null); void reload(); }}
                />
            </AppShell>
        );
    }

    return (
        <AppShell appName="キッズタウンぎんこう" accentColor="#2b6cb0">
            <div className="kt-toolbar">
                <input
                    type="search" placeholder="口座ID・市民番号・店名で検索"
                    value={filter} onChange={e => setFilter(e.target.value)}
                />
                <span>{filtered.length} 口座</span>
                <div className="kt-spacer" />
                <button className="kt-btn" onClick={() => void reload()} disabled={loading}>
                    {loading ? '読込中…' : '再読込'}
                </button>
                <button className="kt-btn" onClick={exportAccounts}>口座CSV</button>
                <button className="kt-btn" onClick={() => void exportAllLedgers()}>全明細CSV</button>
            </div>

            <DataTable
                columns={columns}
                rows={filtered}
                rowKey={a => a.cardKey}
                onRowClick={a => { if (a.id !== '') setSelected(a); }}
                emptyText={loading ? '読み込み中…' : '口座がありません'}
            />
            <p className="kt-hint" style={{marginTop: 8}}>
                行をクリックすると明細と訂正操作を表示します。「不明」口座は規約外の書込み
                (明細のない残高更新など) で、口座IDを復元できないものです。
            </p>
        </AppShell>
    );
}
