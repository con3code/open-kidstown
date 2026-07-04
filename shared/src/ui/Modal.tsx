import type {ReactNode} from 'react';

export interface ModalProps {
    title: string;
    onClose: () => void;
    children: ReactNode;
    footer?: ReactNode;
}

export function Modal({title, onClose, children, footer}: ModalProps): ReactNode {
    return (
        <div className="kt-modal-backdrop" onClick={onClose}>
            <div className="kt-modal" onClick={e => e.stopPropagation()}>
                <div className="kt-modal-head">
                    <h2>{title}</h2>
                    <button className="kt-btn kt-btn-ghost" onClick={onClose} aria-label="閉じる">✕</button>
                </div>
                <div className="kt-modal-body">{children}</div>
                {footer && <div className="kt-modal-foot">{footer}</div>}
            </div>
        </div>
    );
}
