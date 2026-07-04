import type {ReactNode} from 'react';
import {useTown} from './TownContext';

export interface AppShellProps {
    appName: string;
    accentColor?: string;
    actions?: ReactNode;
    children: ReactNode;
}

/** 全アプリ共通のヘッダー付きレイアウト */
export function AppShell({appName, accentColor = '#2b6cb0', actions, children}: AppShellProps): ReactNode {
    const town = useTown();
    return (
        <div className="kt-shell">
            <header className="kt-header" style={{background: accentColor}}>
                <h1>{appName}</h1>
                <span className="kt-project" title="接続中の Firebase プロジェクト">
                    {town.projectId}
                </span>
                <div className="kt-header-actions">
                    {actions}
                    <button className="kt-btn kt-btn-ghost" onClick={town.lock}>ロック</button>
                </div>
            </header>
            <main className="kt-main">{children}</main>
        </div>
    );
}
