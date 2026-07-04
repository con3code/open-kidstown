/**
 * numberbank 互換の Firestore クライアント。
 * データ規約 (docs/namespace.md / docs/architecture.md):
 *   card/{SHA256(BANK+CARD)} = { number, bank_key, card_key, master_key, time_stamp }
 *   bank/{SHA256(BANK)}      = { bank_name, time_stamp }
 * 書込みは必ず card + bank を同一バッチ/トランザクションで行う(numberbank 2.6 と同じ)。
 */
import {
    doc, getDoc, deleteDoc, writeBatch, runTransaction,
    collection, query, where, getDocs, orderBy, startAt, endBefore,
    type Firestore
} from 'firebase/firestore';
import {cardAddress, sha256Hex, toFiniteNumber} from './hash';

export interface CardRow {
    docId: string;
    /** number フィールドの生値 (文字列 or 数値) */
    value: unknown;
    cardKey: string;
    timeStamp: number;
}

export class NbClient {
    constructor(
        readonly db: Firestore,
        readonly masterKeySha256: string
    ) {}

    /** 値を読む。未登録は null */
    async get(bank: string, card: string): Promise<unknown> {
        const a = await cardAddress(bank, card);
        const snap = await getDoc(doc(this.db, 'card', a.docId));
        return snap.exists() ? snap.data().number : null;
    }

    /** 値を読んで文字列化。未登録は '' (Scratch の value of と同じ感覚) */
    async getString(bank: string, card: string): Promise<string> {
        const v = await this.get(bank, card);
        return v === null || v === undefined ? '' : String(v);
    }

    async exists(bank: string, card: string): Promise<boolean> {
        return (await this.get(bank, card)) !== null;
    }

    /** numberbank putNum 互換: 値を無変換で保存 (card+bank 同一バッチ) */
    async put(bank: string, card: string, value: string | number): Promise<void> {
        const a = await cardAddress(bank, card);
        const now = Date.now();
        const batch = writeBatch(this.db);
        batch.set(doc(this.db, 'card', a.docId), {
            number: value,
            bank_key: a.bankKey,
            card_key: a.cardKey,
            master_key: this.masterKeySha256,
            time_stamp: now
        });
        batch.set(doc(this.db, 'bank', a.bankKey), {
            bank_name: a.bank,
            time_stamp: now
        });
        await batch.commit();
    }

    /** numberbank changeNum 互換: トランザクションで加算し、加算後の値を返す */
    async change(bank: string, card: string, delta: number): Promise<number> {
        const a = await cardAddress(bank, card);
        return runTransaction(this.db, async tx => {
            const snap = await tx.get(doc(this.db, 'card', a.docId));
            const base = snap.exists() ? toFiniteNumber(snap.data().number, 0) : 0;
            const next = base + toFiniteNumber(delta, 0);
            const now = Date.now();
            tx.set(doc(this.db, 'card', a.docId), {
                number: next,
                bank_key: a.bankKey,
                card_key: a.cardKey,
                master_key: this.masterKeySha256,
                time_stamp: now
            });
            tx.set(doc(this.db, 'bank', a.bankKey), {
                bank_name: a.bank,
                time_stamp: now
            });
            return next;
        });
    }

    /**
     * card ドキュメントを物理削除する (Web 管理アプリのみの操作。
     * Scratch からは「未登録」= 空値に見える)
     */
    async remove(bank: string, card: string): Promise<void> {
        const a = await cardAddress(bank, card);
        await deleteDoc(doc(this.db, 'card', a.docId));
    }

    /**
     * バンク配下の全カードを列挙する。
     * Firestore クエリ: master_key == SHA256(masterkey) && bank_key == SHA256(BANK)
     * CARD 平文はハッシュのみのため、主キーは値(JSON)から復元すること (docs/namespace.md §0)。
     */
    async listCards(bank: string): Promise<CardRow[]> {
        const bankKey = await sha256Hex(bank.trim());
        const q = query(
            collection(this.db, 'card'),
            where('master_key', '==', this.masterKeySha256),
            where('bank_key', '==', bankKey)
        );
        const snap = await getDocs(q);
        return snap.docs.map(d => {
            const data = d.data();
            return {
                docId: d.id,
                value: data.number,
                cardKey: String(data.card_key ?? ''),
                timeStamp: toFiniteNumber(data.time_stamp, 0)
            };
        });
    }

    /**
     * このマスターキーが書いた全 card ドキュメントを列挙する (バンク横断)。
     * タウン全体の統計・リセット用 (kt-sys)。
     */
    async listCardsByMaster(): Promise<CardRow[]> {
        const q = query(
            collection(this.db, 'card'),
            where('master_key', '==', this.masterKeySha256)
        );
        const snap = await getDocs(q);
        return snap.docs.map(d => {
            const data = d.data();
            return {
                docId: d.id,
                value: data.number,
                cardKey: String(data.card_key ?? ''),
                timeStamp: toFiniteNumber(data.time_stamp, 0)
            };
        });
    }

    /**
     * bank コレクションの前方一致列挙 (docId つき)。削除用 (kt-sys)。
     * bank ドキュメントには master_key がないため、kt.* プレフィックスで
     * 名前空間スコープの削除だけを行うこと。
     */
    async listBanks(prefix: string): Promise<{docId: string; name: string}[]> {
        const q = query(
            collection(this.db, 'bank'),
            orderBy('bank_name'),
            startAt(prefix),
            endBefore(prefix + '\uf8ff')
        );
        const snap = await getDocs(q);
        return snap.docs
            .map(d => ({docId: d.id, name: String(d.data().bank_name ?? '')}))
            .filter(b => b.name.startsWith(prefix));
    }

    /**
     * ドキュメント id 指定の一括削除 (400 件ずつバッチ)。
     * 列挙 (listCards 系 / listBanks) の結果を渡す。kt-sys のリセット用。
     */
    async deleteDocs(collectionName: 'card' | 'bank', docIds: string[]): Promise<number> {
        for (let i = 0; i < docIds.length; i += 400) {
            const batch = writeBatch(this.db);
            for (const id of docIds.slice(i, i + 400)) {
                batch.delete(doc(this.db, collectionName, id));
            }
            await batch.commit();
        }
        return docIds.length;
    }

    /**
     * bank コレクションの bank_name 前方一致列挙。
     * 動的バンク (kt.ledger.* / kt.shop.*) の発見に使う。
     */
    async listBankNames(prefix: string): Promise<string[]> {
        const q = query(
            collection(this.db, 'bank'),
            orderBy('bank_name'),
            startAt(prefix),
            endBefore(prefix + '\uf8ff')
        );
        const snap = await getDocs(q);
        return snap.docs
            .map(d => String(d.data().bank_name ?? ''))
            .filter(n => n.startsWith(prefix));
    }

    /**
     * 採番 (Web 規範: docs/namespace.md §3.1)。
     * kt.counter/<counterName> をトランザクションで +1 し、新しい番号を返す。
     * カウンタ値は「最後に使った番号」。未存在時は start から始める (返る番号は start+1)。
     */
    async allocateNumber(counterName: string, start = 0): Promise<number> {
        const a = await cardAddress('kt.counter', counterName);
        return runTransaction(this.db, async tx => {
            const snap = await tx.get(doc(this.db, 'card', a.docId));
            const base = snap.exists() ? toFiniteNumber(snap.data().number, start) : start;
            const next = base + 1;
            const now = Date.now();
            tx.set(doc(this.db, 'card', a.docId), {
                number: next,
                bank_key: a.bankKey,
                card_key: a.cardKey,
                master_key: this.masterKeySha256,
                time_stamp: now
            });
            tx.set(doc(this.db, 'bank', a.bankKey), {
                bank_name: a.bank,
                time_stamp: now
            });
            return next;
        });
    }
}
