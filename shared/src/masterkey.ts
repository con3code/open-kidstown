/**
 * MasterkeyBank による Firebase 設定解決。
 * numberbank (xcx-numberbank index.js の setMaster / crypt_decode) の移植。
 * マスターキー平文は戻り値に含めず、console にも出力しない。
 */
import {initializeApp, deleteApp, type FirebaseApp} from 'firebase/app';
import {initializeFirestore, type Firestore} from 'firebase/firestore';
import {sha256Hex} from './hash';

const MKB_BASE = 'https://us-central1-masterkey-bank.cloudfunctions.net/';

export interface TownConnection {
    app: FirebaseApp;
    db: Firestore;
    /** SHA-256(masterkey)。card ドキュメントの master_key に使う */
    masterKeySha256: string;
    projectId: string;
    close: () => Promise<void>;
}

interface MkbResponse {
    apiKey?: string;
    authDomain?: string;
    databaseURL?: string;
    projectId?: string;
    storageBucket?: string;
    messagingSenderId?: string;
    appId?: string;
    measurementId?: string;
    cccCheck?: string;
    [k: string]: unknown;
}

function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
    const bin = atob(b64);
    const bytes = new Uint8Array(new ArrayBuffer(bin.length));
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
}

const DECRYPT_PROPS = [
    'apiKey', 'authDomain', 'databaseURL', 'projectId',
    'storageBucket', 'messagingSenderId', 'appId', 'measurementId'
] as const;

/**
 * AES-CTR 復号: key = SHA-256(masterkey), counter = cccCheck, length 64。
 * numberbank crypt_decode と同一パラメータ。
 */
async function decryptConfig(body: MkbResponse, masterKey: string): Promise<Record<string, string>> {
    if (!body.cccCheck) throw new Error('マスターキーが違います');
    const counter = b64ToBytes(body.cccCheck);
    const keyRaw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(masterKey));
    const key = await crypto.subtle.importKey('raw', keyRaw, 'AES-CTR', false, ['decrypt']);
    const out: Record<string, string> = {};
    for (const prop of DECRYPT_PROPS) {
        const enc = body[prop];
        if (typeof enc !== 'string' || enc === '') continue;
        const plain = await crypto.subtle.decrypt(
            {name: 'AES-CTR', counter, length: 64}, key, b64ToBytes(enc)
        );
        out[prop] = new TextDecoder('utf-8').decode(plain);
    }
    return out;
}

/**
 * マスターキーからタウン(Firestore プロジェクト)へ接続する。
 * 失敗時は日本語メッセージの Error を投げる。
 */
export async function connectTown(masterKeyInput: string): Promise<TownConnection> {
    const masterKey = masterKeyInput.trim();
    if (masterKey === '') throw new Error('マスターキーを入力してください');

    const masterKeySha256 = await sha256Hex(masterKey);

    let res: Response;
    try {
        res = await fetch(`${MKB_BASE}mkeybank/?mkey=${encodeURIComponent(masterKey)}`, {mode: 'cors'});
    } catch {
        throw new Error('MasterkeyBank に接続できません(ネットワークを確認してください)');
    }
    if (!res.ok) throw new Error('マスターキーが違います');

    let body: MkbResponse;
    try {
        body = await res.json();
    } catch {
        throw new Error('マスターキーが違います');
    }

    const config = await decryptConfig(body, masterKey);
    if (!config.projectId || !config.apiKey) throw new Error('マスターキーが違います');

    // 再接続(ロック→解除)を許すため、アプリ名は毎回ユニークにする
    const app = initializeApp(config, `kidstown-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    const db = initializeFirestore(app, {});

    return {
        app,
        db,
        masterKeySha256,
        projectId: config.projectId,
        close: () => deleteApp(app)
    };
}
