import {createContext, useContext} from 'react';
import type {NbClient} from '../nbclient';

export interface Town {
    client: NbClient;
    projectId: string;
    /** 接続を破棄してマスターキー入力画面に戻る */
    lock: () => void;
}

export const TownContext = createContext<Town | null>(null);

export function useTown(): Town {
    const town = useContext(TownContext);
    if (!town) throw new Error('useTown must be used inside <MasterKeyGate>');
    return town;
}
