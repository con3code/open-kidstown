import {useMemo, useState, type ReactNode} from 'react';

export interface Column<T> {
    key: string;
    label: string;
    render: (row: T) => ReactNode;
    /** ソート用の値。省略時はソート不可の列 */
    sortValue?: (row: T) => string | number;
    align?: 'left' | 'right' | 'center';
}

export interface DataTableProps<T> {
    columns: Column<T>[];
    rows: T[];
    rowKey: (row: T) => string;
    onRowClick?: (row: T) => void;
    emptyText?: string;
    /** 初期ソート列 key。'-' 前置で降順 */
    defaultSort?: string;
}

export function DataTable<T>({columns, rows, rowKey, onRowClick, emptyText = 'データがありません', defaultSort}: DataTableProps<T>): ReactNode {
    const [sort, setSort] = useState<string>(defaultSort ?? '');

    const sorted = useMemo(() => {
        if (!sort) return rows;
        const desc = sort.startsWith('-');
        const key = desc ? sort.slice(1) : sort;
        const col = columns.find(c => c.key === key);
        if (!col?.sortValue) return rows;
        const sv = col.sortValue;
        return [...rows].sort((a, b) => {
            const va = sv(a);
            const vb = sv(b);
            const cmp = typeof va === 'number' && typeof vb === 'number'
                ? va - vb
                : String(va).localeCompare(String(vb), 'ja');
            return desc ? -cmp : cmp;
        });
    }, [rows, sort, columns]);

    const toggleSort = (col: Column<T>): void => {
        if (!col.sortValue) return;
        setSort(prev => (prev === col.key ? `-${col.key}` : col.key));
    };

    return (
        <div className="kt-table-wrap">
            <table className="kt-table">
                <thead>
                    <tr>
                        {columns.map(c => (
                            <th
                                key={c.key}
                                style={{textAlign: c.align ?? 'left', cursor: c.sortValue ? 'pointer' : 'default'}}
                                onClick={() => toggleSort(c)}
                            >
                                {c.label}
                                {sort === c.key && ' ▲'}
                                {sort === `-${c.key}` && ' ▼'}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {sorted.length === 0 && (
                        <tr><td className="kt-empty" colSpan={columns.length}>{emptyText}</td></tr>
                    )}
                    {sorted.map(row => (
                        <tr
                            key={rowKey(row)}
                            className={onRowClick ? 'kt-row-clickable' : undefined}
                            onClick={onRowClick ? () => onRowClick(row) : undefined}
                        >
                            {columns.map(c => (
                                <td key={c.key} style={{textAlign: c.align ?? 'left'}}>{c.render(row)}</td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
