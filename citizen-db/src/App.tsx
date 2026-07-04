import {useCallback, useEffect, useMemo, useState, type ReactNode} from 'react';
import {
    AppShell, DataTable, Modal, useToast, useTown,
    KT, parseRecord, formatTs, normalizeIdm, isIdm, toFiniteNumber,
    downloadCsv, readCsvFile, sha256Hex,
    CITIZEN_STATUS_LABELS, isCitizenStatus,
    type CitizenProfile, type CitizenStatus, type Column, type CardRow
} from '@kidstown/shared';
import {
    allocateCitizenNo, saveProfile, registerCitizen, bindCard,
    reassignIdm, deleteCitizen, emptyProfile
} from './ops';

const STATUS_BADGE: Record<CitizenStatus, string> = {
    active: 'kt-badge kt-badge-green',
    suspended: 'kt-badge kt-badge-gray',
    retired: 'kt-badge kt-badge-red'
};

export function App(): ReactNode {
    const {client} = useTown();
    const toast = useToast();

    const [citizens, setCitizens] = useState<CitizenProfile[]>([]);
    const [unknownRows, setUnknownRows] = useState<CardRow[]>([]);
    const [balances, setBalances] = useState<Record<string, number>>({});
    const [loading, setLoading] = useState(false);
    const [filter, setFilter] = useState('');
    const [statusFilter, setStatusFilter] = useState<'all' | CitizenStatus>('all');

    const [editing, setEditing] = useState<CitizenProfile | null>(null);
    const [isNew, setIsNew] = useState(false);
    const [reassignTarget, setReassignTarget] = useState<CitizenProfile | null>(null);

    const reload = useCallback(async () => {
        setLoading(true);
        try {
            const [rows, idmRows, statusRows] = await Promise.all([
                client.listCards(KT.CITIZEN_PROFILE),
                client.listCards(KT.CITIZEN_IDM),
                client.listCards(KT.CITIZEN_STATUS)
            ]);
            const parsed: CitizenProfile[] = [];
            const unknown: CardRow[] = [];
            for (const row of rows) {
                const p = parseRecord<CitizenProfile>(row.value);
                if (p && typeof p.no === 'string') parsed.push({note: '', ...p});
                else unknown.push(row);
            }
            // 単一値アドレス (窓口 sb3 が書く方) を正として profile の値に上書きする。
            // card_key = SHA256(市民番号) なので番号からキーを計算して突合する。
            const idmByKey = new Map(idmRows.map(r => [r.cardKey, String(r.value ?? '')]));
            const statusByKey = new Map(statusRows.map(r => [r.cardKey, String(r.value ?? '')]));
            for (const p of parsed) {
                const key = await sha256Hex(p.no);
                const idmOv = idmByKey.get(key);
                if (idmOv !== undefined && normalizeIdm(idmOv) !== '') p.idm = normalizeIdm(idmOv);
                const stOv = statusByKey.get(key);
                if (isCitizenStatus(stOv)) p.status = stOv;
            }
            parsed.sort((a, b) => a.no.localeCompare(b.no, 'ja', {numeric: true}));
            setCitizens(parsed);
            setUnknownRows(unknown);

            const idms = parsed.map(p => p.idm).filter(idm => idm !== '');
            const entries = await Promise.all(idms.map(async idm => {
                const v = await client.get(KT.BALANCE, idm);
                return [idm, v === null ? NaN : toFiniteNumber(v, 0)] as const;
            }));
            setBalances(Object.fromEntries(entries));
        } catch (err) {
            toast(`読み込みに失敗しました: ${err instanceof Error ? err.message : err}`, 'error');
        } finally {
            setLoading(false);
        }
    }, [client, toast]);

    useEffect(() => { void reload(); }, [reload]);

    const filtered = useMemo(() => citizens.filter(c => {
        if (statusFilter !== 'all' && c.status !== statusFilter) return false;
        if (filter.trim() === '') return true;
        const q = filter.trim().toLowerCase();
        return c.no.toLowerCase().includes(q) ||
            c.idm.toLowerCase().includes(q) ||
            (c.note ?? '').toLowerCase().includes(q);
    }), [citizens, filter, statusFilter]);

    const balanceText = (c: CitizenProfile): string => {
        if (c.idm === '') return '—';
        const b = balances[c.idm];
        if (b === undefined) return '…';
        return Number.isNaN(b) ? '未開設' : String(b);
    };

    const columns: Column<CitizenProfile>[] = [
        {key: 'no', label: '市民番号', render: c => c.no, sortValue: c => Number(c.no) || 0},
        {key: 'idm', label: 'IDm', render: c => <span className="kt-mono">{c.idm || '(未発行)'}</span>, sortValue: c => c.idm},
        {key: 'registered', label: '登録日', render: c => formatTs(c.registered), sortValue: c => c.registered},
        {
            key: 'status', label: '状態',
            render: c => <span className={STATUS_BADGE[c.status] ?? 'kt-badge kt-badge-gray'}>{CITIZEN_STATUS_LABELS[c.status] ?? c.status}</span>,
            sortValue: c => c.status
        },
        {key: 'note', label: 'メモ', render: c => c.note ?? ''},
        {key: 'balance', label: '残高', align: 'right', render: c => balanceText(c), sortValue: c => balances[c.idm] ?? -1}
    ];

    const exportCsv = (): void => {
        downloadCsv('citizens.csv', [
            ['市民番号', 'IDm', '登録日', '状態', 'メモ', '残高'],
            ...filtered.map(c => [c.no, c.idm, c.registered, c.status, c.note ?? '', balanceText(c)])
        ]);
    };

    const importCsv = async (file: File): Promise<void> => {
        try {
            let rows = await readCsvFile(file);
            if (rows.length > 0 && rows[0][0]?.trim() === '市民番号') rows = rows.slice(1);
            let ok = 0;
            for (const row of rows) {
                const [noRaw = '', idmRaw = '', registered = '', status = '', note = ''] = row.map(s => s.trim());
                if (noRaw === '' && idmRaw === '' && note === '') continue;
                const no = noRaw === '' ? await allocateCitizenNo(client) : noRaw;
                if (noRaw !== '' && citizens.some(c => c.no === noRaw)) {
                    if (!window.confirm(`市民番号 ${noRaw} は登録済みです。上書きしますか?`)) continue;
                }
                const st: CitizenStatus = (['active', 'suspended', 'retired'] as const)
                    .find(s => s === status) ?? 'active';
                await registerCitizen(client, {
                    no,
                    idm: normalizeIdm(idmRaw),
                    registered: registered || emptyProfile().registered,
                    status: st,
                    note
                });
                ok++;
            }
            toast(`${ok} 件をインポートしました`, 'success');
            await reload();
        } catch (err) {
            toast(`インポートに失敗しました: ${err instanceof Error ? err.message : err}`, 'error');
            await reload();
        }
    };

    const startAdd = async (): Promise<void> => {
        try {
            const no = await allocateCitizenNo(client);
            setEditing(emptyProfile(no));
            setIsNew(true);
        } catch (err) {
            toast(`採番に失敗しました: ${err instanceof Error ? err.message : err}`, 'error');
        }
    };

    const remove = async (c: CitizenProfile): Promise<void> => {
        if (!window.confirm(
            `市民 ${c.no} を完全に削除します。台帳・カード紐付け・残高が消えます (明細は残ります)。\n` +
            `通常は「状態: 抹消」への変更を推奨します。本当に削除しますか?`
        )) return;
        try {
            await deleteCitizen(client, c);
            toast(`市民 ${c.no} を削除しました`, 'success');
            await reload();
        } catch (err) {
            toast(`削除に失敗しました: ${err instanceof Error ? err.message : err}`, 'error');
        }
    };

    return (
        <AppShell appName="キッズタウン市民DB" accentColor="#2f855a">
            <div className="kt-toolbar">
                <input
                    type="search" placeholder="番号・IDm・メモで検索"
                    value={filter} onChange={e => setFilter(e.target.value)}
                />
                <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as 'all' | CitizenStatus)}>
                    <option value="all">すべての状態</option>
                    <option value="active">有効</option>
                    <option value="suspended">停止</option>
                    <option value="retired">抹消</option>
                </select>
                <span>{filtered.length} 人</span>
                <div className="kt-spacer" />
                <button className="kt-btn" onClick={() => void reload()} disabled={loading}>
                    {loading ? '読込中…' : '再読込'}
                </button>
                <button className="kt-btn" onClick={exportCsv}>CSV出力</button>
                <label className="kt-btn" style={{display: 'inline-block'}}>
                    CSV取込
                    <input
                        type="file" accept=".csv,text/csv" style={{display: 'none'}}
                        onChange={e => {
                            const f = e.target.files?.[0];
                            e.target.value = '';
                            if (f) void importCsv(f);
                        }}
                    />
                </label>
                <button className="kt-btn kt-btn-primary" onClick={() => void startAdd()}>+ 市民登録</button>
            </div>

            <DataTable
                columns={columns}
                rows={filtered}
                rowKey={c => c.no}
                defaultSort="no"
                onRowClick={c => { setEditing(c); setIsNew(false); }}
                emptyText={loading ? '読み込み中…' : '市民が登録されていません'}
            />

            {unknownRows.length > 0 && (
                <div className="kt-section" style={{marginTop: 16}}>
                    <h2>規約外レコード ({unknownRows.length} 件)</h2>
                    <p className="kt-hint">kt.citizen.profile にあるが CitizenProfile JSON として読めないデータです。</p>
                    <DataTable
                        columns={[
                            {key: 'k', label: 'card_key (先頭12桁)', render: (r: CardRow) => <span className="kt-mono">{r.cardKey.slice(0, 12)}…</span>},
                            {key: 'v', label: '生の値', render: (r: CardRow) => String(r.value)},
                            {key: 't', label: '更新', render: (r: CardRow) => new Date(r.timeStamp).toLocaleString('ja-JP')}
                        ]}
                        rows={unknownRows}
                        rowKey={r => r.docId}
                    />
                </div>
            )}

            {editing && (
                <CitizenFormModal
                    profile={editing}
                    isNew={isNew}
                    onClose={() => setEditing(null)}
                    onSaved={async () => { setEditing(null); await reload(); }}
                    onDelete={isNew ? undefined : () => { setEditing(null); void remove(editing); }}
                    onReassign={isNew ? undefined : () => { setReassignTarget(editing); setEditing(null); }}
                />
            )}

            {reassignTarget && (
                <ReassignModal
                    profile={reassignTarget}
                    onClose={() => setReassignTarget(null)}
                    onDone={async () => { setReassignTarget(null); await reload(); }}
                />
            )}
        </AppShell>
    );
}

interface CitizenFormModalProps {
    profile: CitizenProfile;
    isNew: boolean;
    onClose: () => void;
    onSaved: () => Promise<void>;
    onDelete?: () => void;
    onReassign?: () => void;
}

function CitizenFormModal({profile, isNew, onClose, onSaved, onDelete, onReassign}: CitizenFormModalProps): ReactNode {
    const {client} = useTown();
    const toast = useToast();
    const [form, setForm] = useState<CitizenProfile>(profile);
    const [busy, setBusy] = useState(false);

    const set = <K extends keyof CitizenProfile>(key: K, value: CitizenProfile[K]): void => {
        setForm(prev => ({...prev, [key]: value}));
    };

    const save = async (): Promise<void> => {
        setBusy(true);
        try {
            if (isNew) {
                const idm = normalizeIdm(form.idm);
                if (idm !== '' && !isIdm(idm) &&
                    !window.confirm(`「${idm}」は 16 桁 hex の IDm 形式ではありません。このまま登録しますか?`)) {
                    setBusy(false);
                    return;
                }
                await registerCitizen(client, {...form, idm});
                toast(`市民 ${form.no} を登録しました`, 'success');
            } else if (profile.idm === '' && normalizeIdm(form.idm) !== '') {
                // 未発行 → 発行 (紐付け + 口座開設)
                await saveProfile(client, {...form, idm: normalizeIdm(form.idm)});
                await bindCard(client, form.no, form.idm);
                toast(`市民 ${form.no} にカードを発行しました`, 'success');
            } else {
                // IDm は編集不可 (差し替えは専用操作)。プロフィールのみ更新
                await saveProfile(client, {...form, idm: profile.idm});
                toast(`市民 ${form.no} を更新しました`, 'success');
            }
            await onSaved();
        } catch (err) {
            toast(`保存に失敗しました: ${err instanceof Error ? err.message : err}`, 'error');
            setBusy(false);
        }
    };

    const idmEditable = isNew || profile.idm === '';

    return (
        <Modal
            title={isNew ? `市民登録 (番号 ${form.no})` : `市民 ${form.no} の編集`}
            onClose={onClose}
            footer={
                <>
                    {onDelete && <button className="kt-btn kt-btn-danger" onClick={onDelete} disabled={busy}>削除…</button>}
                    {onReassign && <button className="kt-btn" onClick={onReassign} disabled={busy}>カード差し替え…</button>}
                    <button className="kt-btn" onClick={onClose} disabled={busy}>キャンセル</button>
                    <button className="kt-btn kt-btn-primary" onClick={() => void save()} disabled={busy}>
                        {busy ? '保存中…' : '保存'}
                    </button>
                </>
            }
        >
            <div className="kt-form">
                <label>
                    IDm (市民カード)
                    <input
                        className="kt-mono"
                        value={form.idm}
                        placeholder={idmEditable ? '16桁hex / 空=後日発行' : ''}
                        disabled={!idmEditable}
                        onChange={e => set('idm', e.target.value)}
                    />
                    {!idmEditable && <span className="kt-hint">IDm の変更は「カード差し替え」から行います (残高移行つき)</span>}
                </label>
                <label>
                    登録日 (YYYYMMDD)
                    <input value={form.registered} onChange={e => set('registered', e.target.value)} />
                </label>
                <label>
                    状態
                    <select value={form.status} onChange={e => set('status', e.target.value as CitizenStatus)}>
                        <option value="active">有効</option>
                        <option value="suspended">停止</option>
                        <option value="retired">抹消</option>
                    </select>
                </label>
                <label>
                    メモ
                    <input value={form.note ?? ''} onChange={e => set('note', e.target.value)} />
                </label>
            </div>
        </Modal>
    );
}

interface ReassignModalProps {
    profile: CitizenProfile;
    onClose: () => void;
    onDone: () => Promise<void>;
}

function ReassignModal({profile, onClose, onDone}: ReassignModalProps): ReactNode {
    const {client} = useTown();
    const toast = useToast();
    const [newIdm, setNewIdm] = useState('');
    const [busy, setBusy] = useState(false);

    const run = async (): Promise<void> => {
        const idm = normalizeIdm(newIdm);
        if (!isIdm(idm) &&
            !window.confirm(`「${idm}」は 16 桁 hex の IDm 形式ではありません。このまま差し替えますか?`)) {
            return;
        }
        if (idm === normalizeIdm(profile.idm)) {
            toast('現在と同じ IDm です', 'error');
            return;
        }
        setBusy(true);
        try {
            await reassignIdm(client, profile, idm);
            toast(`市民 ${profile.no} のカードを差し替えました (残高移行済み)`, 'success');
            await onDone();
        } catch (err) {
            toast(`差し替えに失敗しました: ${err instanceof Error ? err.message : err}。再実行すると続きから回復できます`, 'error');
            setBusy(false);
        }
    };

    return (
        <Modal
            title={`カード差し替え (市民 ${profile.no})`}
            onClose={onClose}
            footer={
                <>
                    <button className="kt-btn" onClick={onClose} disabled={busy}>キャンセル</button>
                    <button className="kt-btn kt-btn-primary" onClick={() => void run()} disabled={busy || newIdm.trim() === ''}>
                        {busy ? '処理中…' : '差し替え実行'}
                    </button>
                </>
            }
        >
            <div className="kt-form">
                <p className="kt-hint">
                    旧カード ({profile.idm || 'なし'}) の残高を新カードへ移し、旧カードを無効化します。
                    双方の口座に管理訂正の明細が記帳されます。
                </p>
                <label>
                    新しいカードの IDm
                    <input
                        className="kt-mono" autoFocus value={newIdm}
                        placeholder="16桁hex" onChange={e => setNewIdm(e.target.value)}
                    />
                </label>
            </div>
        </Modal>
    );
}
