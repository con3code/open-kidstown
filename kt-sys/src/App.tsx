import {useCallback, useEffect, useState, type ReactNode} from 'react';
import {AppShell, Modal, formatTs, tsNow, useToast, useTown} from '@kidstown/shared';
import {
    gatherStats, listAccounts, purgeClaims, resetBalances, resetShopTx, fullTownReset,
    exportTown, parseTownDump, importTown,
    type TownStats, type SysAccount, type Progress, type TownDump
} from './ops';

type Dialog =
    | {kind: 'claims'}
    | {kind: 'balances'}
    | {kind: 'shop'; shopId: string}
    | {kind: 'full'}
    | {kind: 'import'}
    | null;

function downloadJson(filename: string, obj: unknown): void {
    const blob = new Blob([JSON.stringify(obj)], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function App(): ReactNode {
    const {client} = useTown();
    const toast = useToast();
    const [stats, setStats] = useState<TownStats | null>(null);
    const [loading, setLoading] = useState(false);
    const [busyMsg, setBusyMsg] = useState('');
    const [dialog, setDialog] = useState<Dialog>(null);

    const reload = useCallback(async () => {
        setLoading(true);
        try {
            setStats(await gatherStats(client));
        } catch (err) {
            toast(`統計の取得に失敗しました: ${err instanceof Error ? err.message : err}`, 'error');
        } finally {
            setLoading(false);
        }
    }, [client, toast]);

    useEffect(() => { void reload(); }, [reload]);

    const busy = busyMsg !== '';
    const progress: Progress = msg => setBusyMsg(msg);

    /** 操作の共通ラッパ: 進捗表示 → 完了トースト → 統計再読込 */
    const run = async (label: string, op: () => Promise<string>): Promise<void> => {
        setBusyMsg(`${label} を実行中…`);
        try {
            const summary = await op();
            toast(`${label}: ${summary}`, 'success');
            setDialog(null);
            await reload();
        } catch (err) {
            toast(`${label} に失敗しました: ${err instanceof Error ? err.message : err}。再実行で続きから回復できます`, 'error');
        } finally {
            setBusyMsg('');
        }
    };

    return (
        <AppShell appName="キッズタウン システム管理" accentColor="#822727">
            <p className="kt-hint" style={{marginBottom: 12}}>
                タウンのデータを一括操作する管理者専用アプリです。
                <b>操作の前に窓口アプリ (Xcratch) をすべて止めてください。</b>
                削除は元に戻せません。
            </p>

            <div className="kt-section">
                <div className="kt-toolbar">
                    <h2 style={{fontSize: 16}}>タウン統計</h2>
                    <div className="kt-spacer" />
                    {busy && <span className="kt-badge kt-badge-blue">{busyMsg}</span>}
                    <button className="kt-btn" onClick={() => void reload()} disabled={loading || busy}>
                        {loading ? '読込中…' : '再読込'}
                    </button>
                </div>
                {stats && (
                    <div className="kt-table-wrap">
                        <table className="kt-table">
                            <tbody>
                                <tr><td>全データ (card)</td><td style={{textAlign: 'right'}}>{stats.totalCards} 件</td></tr>
                                <tr><td>市民台帳</td><td style={{textAlign: 'right'}}>{stats.citizens} 人</td></tr>
                                <tr><td>口座 (kt.balance)</td><td style={{textAlign: 'right'}}>{stats.accounts} 口座</td></tr>
                                <tr><td>入出金明細</td><td style={{textAlign: 'right'}}>{stats.ledgerEntries} 件 ({stats.ledgerBanks} 口座分)</td></tr>
                                <tr>
                                    <td>店舗の取引</td>
                                    <td style={{textAlign: 'right'}}>
                                        {stats.shopTx.length === 0
                                            ? '0 件'
                                            : stats.shopTx.map(s => `${s.shopId}: ${s.count}件`).join(' / ')}
                                    </td>
                                </tr>
                                <tr><td>採番カウンタ</td><td style={{textAlign: 'right'}}>{stats.counters} 個</td></tr>
                                <tr><td>使用済み claim</td><td style={{textAlign: 'right'}}>{stats.claims} 件</td></tr>
                            </tbody>
                        </table>
                    </div>
                )}
                {!stats && <p className="kt-hint">{loading ? '読み込み中…' : ''}</p>}
            </div>

            <div className="kt-section">
                <h2 style={{fontSize: 16, marginBottom: 10}}>メンテナンス操作</h2>
                <div className="kt-cards">
                    <div className="kt-card" onClick={() => !busy && setDialog({kind: 'claims'})}>
                        <h3>claim の掃除</h3>
                        <p>使用済みの採番 claim ({stats?.claims ?? '…'} 件) を一括削除。カウンタ・データには触りません</p>
                    </div>
                    <div className="kt-card" onClick={() => !busy && setDialog({kind: 'balances'})}>
                        <h3>残高の一括リセット</h3>
                        <p>全口座 (または市民/店舗のみ) の残高を 0 か指定額に設定。明細の初期化も選べます</p>
                    </div>
                    {(stats?.shopTx ?? []).map(s => (
                        <div key={s.shopId} className="kt-card" onClick={() => !busy && setDialog({kind: 'shop', shopId: s.shopId})}>
                            <h3>店舗 {s.shopId} の取引リセット</h3>
                            <p>取引 {s.count} 件を削除し、取引番号を 1 からやり直します</p>
                        </div>
                    ))}
                    <div className="kt-card" onClick={() => {
                        if (busy) return;
                        void run('JSON書き出し', async () => {
                            const dump = await exportTown(client);
                            downloadJson(`town-dump-${tsNow()}.json`, dump);
                            return `card ${dump.cards.length} 件 / bank ${dump.banks.length} 件を書き出しました`;
                        });
                    }}>
                        <h3>タウン全体をJSONで書き出し</h3>
                        <p>全データ ({stats?.totalCards ?? '…'} 件) をファイルに保存。バックアップや別マスターキーへの引っ越しに</p>
                    </div>
                    <div className="kt-card" onClick={() => !busy && setDialog({kind: 'import'})}>
                        <h3>JSONから読み込み</h3>
                        <p>書き出したファイルを復元。接続中のタウンのデータとして書き込まれます (引っ越しにも使えます)</p>
                    </div>
                    <div className="kt-card" style={{borderColor: '#fc8181'}} onClick={() => !busy && setDialog({kind: 'full'})}>
                        <h3 style={{color: '#c53030'}}>タウン全体リセット</h3>
                        <p>このマスターキーの全データ ({stats?.totalCards ?? '…'} 件) を消去して最初からやり直します</p>
                    </div>
                </div>
            </div>

            {dialog?.kind === 'claims' && stats && (
                <Modal
                    title="claim の掃除"
                    onClose={() => setDialog(null)}
                    footer={
                        <>
                            <button className="kt-btn" onClick={() => setDialog(null)} disabled={busy}>キャンセル</button>
                            <button
                                className="kt-btn kt-btn-primary" disabled={busy}
                                onClick={() => void run('claim掃除', async () => `${await purgeClaims(client)} 件削除しました`)}
                            >
                                {busy ? busyMsg : `${stats.claims} 件を削除する`}
                            </button>
                        </>
                    }
                >
                    <p>使用済みの採番 claim を削除します。カウンタは触らないため取引番号は続きから発番されます。</p>
                    <p className="kt-hint">窓口アプリが採番している最中に実行すると、その採番がやり直しになることがあります (データは壊れません)。</p>
                </Modal>
            )}

            {dialog?.kind === 'balances' && (
                <BalanceResetModal
                    busy={busy} busyMsg={busyMsg}
                    onClose={() => setDialog(null)}
                    onRun={(accounts, amount, clearLedger) => void run('残高一括リセット', async () => {
                        const r = await resetBalances(client, accounts, amount, clearLedger, progress);
                        return `${r.updated} 口座を ${amount} に設定${clearLedger ? `、明細 ${r.ledgerDeleted} 件を初期化` : ''}しました`;
                    })}
                />
            )}

            {dialog?.kind === 'shop' && (
                <Modal
                    title={`店舗 ${dialog.shopId} の取引リセット`}
                    onClose={() => setDialog(null)}
                    footer={
                        <ShopResetFooter
                            busy={busy} busyMsg={busyMsg}
                            onRun={alsoAccount => void run(`店舗 ${dialog.shopId} リセット`, async () => {
                                const r = await resetShopTx(client, dialog.shopId, alsoAccount, progress);
                                return `取引 ${r.txDeleted} 件を削除、番号を 1 から再開します (claim ${r.claimsDeleted} 件も掃除)`;
                            })}
                            onCancel={() => setDialog(null)}
                        />
                    }
                >
                    <p>店舗 {dialog.shopId} の売買取引レコードをすべて削除し、取引番号カウンタを消して 1 番からやり直します。</p>
                    <p className="kt-hint">
                        カウンタを巻き戻すため、タウン全体の使用済み claim も一緒に掃除します
                        (他店舗のデータ・番号には影響しません)。
                    </p>
                </Modal>
            )}

            {dialog?.kind === 'import' && (
                <ImportModal
                    busy={busy} busyMsg={busyMsg}
                    onClose={() => setDialog(null)}
                    onRun={(dump, clean) => void run('JSON読み込み', async () => {
                        const r = await importTown(client, dump, clean, progress);
                        return `card ${r.cards} 件 / bank ${r.banks} 件を書き込みました` +
                            (r.deleted ? ` (先に ${r.deleted.cards} 件を削除)` : '');
                    })}
                />
            )}

            {dialog?.kind === 'full' && stats && (
                <FullResetModal
                    stats={stats} busy={busy} busyMsg={busyMsg}
                    onClose={() => setDialog(null)}
                    onRun={() => void run('タウン全体リセット', async () => {
                        const r = await fullTownReset(client, progress);
                        return `card ${r.cards} 件 / bank ${r.banks} 件を削除しました。タウンは空になりました`;
                    })}
                />
            )}
        </AppShell>
    );
}

interface BalanceResetModalProps {
    busy: boolean;
    busyMsg: string;
    onClose: () => void;
    onRun: (accounts: SysAccount[], amount: number, clearLedger: boolean) => void;
}

function BalanceResetModal({busy, busyMsg, onClose, onRun}: BalanceResetModalProps): ReactNode {
    const {client} = useTown();
    const toast = useToast();
    const [accounts, setAccounts] = useState<SysAccount[] | null>(null);
    const [scope, setScope] = useState<'all' | 'citizen' | 'shop'>('all');
    const [amount, setAmount] = useState('0');
    const [clearLedger, setClearLedger] = useState(false);

    useEffect(() => {
        listAccounts(client).then(setAccounts).catch(err => {
            toast(`口座の列挙に失敗しました: ${err instanceof Error ? err.message : err}`, 'error');
        });
    }, [client, toast]);

    const targets = (accounts ?? []).filter(a => scope === 'all' || a.kind === scope);
    const amountNum = Number(amount);
    const valid = Number.isFinite(amountNum) && amountNum >= 0 && targets.length > 0;

    return (
        <Modal
            title="残高の一括リセット"
            onClose={onClose}
            footer={
                <>
                    <button className="kt-btn" onClick={onClose} disabled={busy}>キャンセル</button>
                    <button
                        className="kt-btn kt-btn-danger" disabled={busy || !valid}
                        onClick={() => onRun(targets, amountNum, clearLedger)}
                    >
                        {busy ? busyMsg : `${targets.length} 口座を ${amount} にする`}
                    </button>
                </>
            }
        >
            <div className="kt-form">
                <label>
                    対象
                    <select value={scope} onChange={e => setScope(e.target.value as typeof scope)}>
                        <option value="all">すべての口座</option>
                        <option value="citizen">市民の口座のみ</option>
                        <option value="shop">店舗の口座のみ</option>
                    </select>
                </label>
                <label>
                    設定する残高
                    <input type="number" min="0" value={amount} onChange={e => setAmount(e.target.value)} />
                </label>
                <label className="kt-inline">
                    <input type="checkbox" checked={clearLedger} onChange={e => setClearLedger(e.target.checked)} />
                    入出金明細も削除して初期化する (init 明細 1 件だけ残る)
                </label>
                <p className="kt-hint">
                    {accounts === null
                        ? '口座を数えています…'
                        : `対象: ${targets.length} 口座 (市民 ${accounts.filter(a => a.kind === 'citizen').length} / 店舗 ${accounts.filter(a => a.kind === 'shop').length} / その他 ${accounts.filter(a => a.kind === 'other').length})`}
                    {clearLedger ? '' : ' — 明細は残し、差額を adjust として記帳します'}
                </p>
            </div>
        </Modal>
    );
}

interface ShopResetFooterProps {
    busy: boolean;
    busyMsg: string;
    onRun: (alsoAccount: boolean) => void;
    onCancel: () => void;
}

function ShopResetFooter({busy, busyMsg, onRun, onCancel}: ShopResetFooterProps): ReactNode {
    const [alsoAccount, setAlsoAccount] = useState(false);
    return (
        <>
            <label className="kt-inline" style={{marginRight: 'auto', fontSize: 13}}>
                <input type="checkbox" checked={alsoAccount} onChange={e => setAlsoAccount(e.target.checked)} />
                店舗口座も 0 に初期化
            </label>
            <button className="kt-btn" onClick={onCancel} disabled={busy}>キャンセル</button>
            <button className="kt-btn kt-btn-danger" disabled={busy} onClick={() => onRun(alsoAccount)}>
                {busy ? busyMsg : 'リセットする'}
            </button>
        </>
    );
}

interface ImportModalProps {
    busy: boolean;
    busyMsg: string;
    onClose: () => void;
    onRun: (dump: TownDump, clean: boolean) => void;
}

function ImportModal({busy, busyMsg, onClose, onRun}: ImportModalProps): ReactNode {
    const [dump, setDump] = useState<TownDump | null>(null);
    const [fileError, setFileError] = useState('');
    const [clean, setClean] = useState(false);
    const [typed, setTyped] = useState('');

    const onFile = async (file: File): Promise<void> => {
        setDump(null);
        setFileError('');
        try {
            setDump(parseTownDump(await file.text()));
        } catch (err) {
            setFileError(err instanceof Error ? err.message : '読み込みに失敗しました');
        }
    };

    const ready = dump !== null && (!clean || typed === 'リセット');

    return (
        <Modal
            title="JSONから読み込み"
            onClose={onClose}
            footer={
                <>
                    <button className="kt-btn" onClick={onClose} disabled={busy}>キャンセル</button>
                    <button
                        className="kt-btn kt-btn-danger" disabled={busy || !ready}
                        onClick={() => dump && onRun(dump, clean)}
                    >
                        {busy ? busyMsg : dump ? `card ${dump.cards.length} 件を書き込む` : 'ファイルを選んでください'}
                    </button>
                </>
            }
        >
            <div className="kt-form">
                <p className="kt-hint">
                    「タウン全体をJSONで書き出し」で保存したファイルを、<b>いま接続しているタウン</b>の
                    データとして書き込みます (別のマスターキーで書き出したファイルでも OK =
                    タウンの引っ越し)。実行前に窓口アプリを止めてください。
                </p>
                <label>
                    ダンプファイル (.json)
                    <input
                        type="file" accept=".json,application/json" disabled={busy}
                        onChange={e => {
                            const f = e.target.files?.[0];
                            e.target.value = '';
                            if (f) void onFile(f);
                        }}
                    />
                </label>
                {fileError && <p style={{color: '#c53030', margin: 0}}>{fileError}</p>}
                {dump && (
                    <p className="kt-hint">
                        書き出し日時: {formatTs(dump.exportedAt)} / card {dump.cards.length} 件 /
                        bank {dump.banks.length} 件
                    </p>
                )}
                <label className="kt-inline">
                    <input
                        type="checkbox" checked={clean} disabled={busy}
                        onChange={e => setClean(e.target.checked)}
                    />
                    先にタウン全体を削除してから読み込む (クリーンリストア)
                </label>
                {!clean && (
                    <p className="kt-hint">
                        チェックしない場合はマージ: 同じデータは上書き、ファイルにないデータは残ります。
                    </p>
                )}
                {clean && (
                    <label>
                        確認のため「リセット」と入力してください
                        <input value={typed} disabled={busy} placeholder="リセット"
                            onChange={e => setTyped(e.target.value)} />
                    </label>
                )}
            </div>
        </Modal>
    );
}

interface FullResetModalProps {
    stats: TownStats;
    busy: boolean;
    busyMsg: string;
    onClose: () => void;
    onRun: () => void;
}

function FullResetModal({stats, busy, busyMsg, onClose, onRun}: FullResetModalProps): ReactNode {
    const [typed, setTyped] = useState('');
    return (
        <Modal
            title="⚠ タウン全体リセット"
            onClose={onClose}
            footer={
                <>
                    <button className="kt-btn" onClick={onClose} disabled={busy}>キャンセル</button>
                    <button
                        className="kt-btn kt-btn-danger"
                        disabled={busy || typed !== 'リセット'}
                        onClick={onRun}
                    >
                        {busy ? busyMsg : 'すべて消去する'}
                    </button>
                </>
            }
        >
            <div className="kt-form">
                <p>
                    このマスターキーのデータ <b>{stats.totalCards} 件</b>
                    (市民 {stats.citizens} 人、口座 {stats.accounts}、明細 {stats.ledgerEntries} 件、
                    取引 {stats.shopTx.reduce((s, x) => s + x.count, 0)} 件、カウンタ・claim 含む)
                    をすべて削除します。<b>元に戻せません。</b>
                </p>
                <p className="kt-hint">
                    消えるのはデータだけです。マスターキー自体と Web/Xcratch アプリはそのまま使えます
                    (削除後は市民登録からやり直し)。CSV でのバックアップが必要なら先に各アプリで出力してください。
                </p>
                <label>
                    確認のため「リセット」と入力してください
                    <input autoFocus value={typed} onChange={e => setTyped(e.target.value)} placeholder="リセット" />
                </label>
            </div>
        </Modal>
    );
}
