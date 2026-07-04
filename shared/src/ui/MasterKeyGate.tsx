import {useState, type FormEvent, type ReactNode} from 'react';
import {connectTown, type TownConnection} from '../masterkey';
import {NbClient} from '../nbclient';
import {TownContext, type Town} from './TownContext';

export interface MasterKeyGateProps {
    /** ヘッダー等に表示するアプリ名 */
    appName: string;
    children: ReactNode;
}

/**
 * 起動時のマスターキー入力ゲート。
 * MasterkeyBank 経由で Firebase 設定を解決し、成功したら children を表示する。
 * マスターキーはメモリのみ保持 (永続化・ログ出力しない)。
 */
export function MasterKeyGate({appName, children}: MasterKeyGateProps): ReactNode {
    const [conn, setConn] = useState<TownConnection | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [input, setInput] = useState('');

    const submit = async (e: FormEvent): Promise<void> => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        setError('');
        try {
            const c = await connectTown(input);
            setInput('');
            setConn(c);
        } catch (err) {
            setError(err instanceof Error ? err.message : '接続に失敗しました');
        } finally {
            setBusy(false);
        }
    };

    if (!conn) {
        return (
            <div className="kt-gate">
                <form className="kt-gate-card" onSubmit={submit}>
                    <h1>{appName}</h1>
                    <p>タウンのマスターキーを入力してください</p>
                    <input
                        type="password"
                        autoFocus
                        autoComplete="off"
                        value={input}
                        placeholder="マスターキー"
                        onChange={e => setInput(e.target.value)}
                    />
                    {error && <p className="kt-error">{error}</p>}
                    <button type="submit" disabled={busy || input.trim() === ''}>
                        {busy ? 'せつぞく中…' : 'せつぞく'}
                    </button>
                </form>
            </div>
        );
    }

    const town: Town = {
        client: new NbClient(conn.db, conn.masterKeySha256),
        projectId: conn.projectId,
        lock: () => {
            void conn.close().catch(() => undefined);
            setConn(null);
        }
    };

    return <TownContext.Provider value={town}>{children}</TownContext.Provider>;
}
