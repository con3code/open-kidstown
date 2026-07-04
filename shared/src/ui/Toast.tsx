import {createContext, useCallback, useContext, useRef, useState, type ReactNode} from 'react';

export type ToastKind = 'info' | 'success' | 'error';

interface ToastItem {
    id: number;
    kind: ToastKind;
    message: string;
}

type ToastFn = (message: string, kind?: ToastKind) => void;

const ToastContext = createContext<ToastFn>(() => undefined);

export function useToast(): ToastFn {
    return useContext(ToastContext);
}

export function ToastProvider({children}: {children: ReactNode}): ReactNode {
    const [items, setItems] = useState<ToastItem[]>([]);
    const seq = useRef(0);

    const push = useCallback<ToastFn>((message, kind = 'info') => {
        const id = ++seq.current;
        setItems(prev => [...prev, {id, kind, message}]);
        setTimeout(() => {
            setItems(prev => prev.filter(t => t.id !== id));
        }, kind === 'error' ? 8000 : 4000);
    }, []);

    return (
        <ToastContext.Provider value={push}>
            {children}
            <div className="kt-toasts">
                {items.map(t => (
                    <div key={t.id} className={`kt-toast kt-toast-${t.kind}`}>{t.message}</div>
                ))}
            </div>
        </ToastContext.Provider>
    );
}
