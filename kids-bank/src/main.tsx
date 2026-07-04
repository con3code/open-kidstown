import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {MasterKeyGate, ToastProvider} from '@kidstown/shared';
import '@kidstown/shared/styles.css';
import {App} from './App';

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <ToastProvider>
            <MasterKeyGate appName="キッズタウンぎんこう">
                <App />
            </MasterKeyGate>
        </ToastProvider>
    </StrictMode>
);
