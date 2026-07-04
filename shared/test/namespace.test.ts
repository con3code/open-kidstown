import {describe, it, expect} from 'vitest';
import {
    KT, accountIdFromLedgerBank, shopIdFromTxBank, shopIdFromAccount,
    parseRecord, serializeRecord, tsNow, formatTs, type ShopTx
} from '../src/namespace';

describe('KT アドレスビルダー', () => {
    it('builds bank names per docs/namespace.md', () => {
        expect(KT.BALANCE).toBe('kt.balance');
        expect(KT.shopTx('B06')).toBe('kt.shop.B06.tx');
        expect(KT.ledger('012e48b0b10c999b')).toBe('kt.ledger.012e48b0b10c999b');
        expect(KT.ledger(KT.shopAccount('B06'))).toBe('kt.ledger.shop.B06');
        expect(KT.counterShopTx('B06')).toBe('shop.B06.tx');
    });

    it('reverses dynamic bank names', () => {
        expect(accountIdFromLedgerBank('kt.ledger.shop.B06')).toBe('shop.B06');
        expect(accountIdFromLedgerBank('kt.balance')).toBeNull();
        expect(shopIdFromTxBank('kt.shop.B06.tx')).toBe('B06');
        expect(shopIdFromTxBank('kt.shop.profile')).toBeNull();
        expect(shopIdFromAccount('shop.B06')).toBe('B06');
        expect(shopIdFromAccount('012e48b0b10c999b')).toBeNull();
    });
});

describe('parseRecord / serializeRecord', () => {
    it('roundtrips a ShopTx', () => {
        const tx: ShopTx = {
            no: '12', t: '20260703143012', shop: 'B06',
            items: [{name: 'けん玉', price: 30, qty: 1}],
            total: 30, payer: '012e48b0b10c999b', status: 'ok'
        };
        const raw = serializeRecord(tx);
        expect(raw).not.toContain('\n');
        expect(parseRecord<ShopTx>(raw)).toEqual(tx);
    });

    it('returns null for non-JSON values (数値文字列の残高など)', () => {
        expect(parseRecord('1200')).toBeNull();
        expect(parseRecord(1200)).toBeNull();
        expect(parseRecord('{broken')).toBeNull();
        expect(parseRecord(null)).toBeNull();
    });
});

describe('timestamps', () => {
    it('tsNow formats 14 digits', () => {
        expect(tsNow(new Date(2026, 6, 3, 14, 30, 12))).toBe('20260703143012');
    });
    it('formatTs renders 14/8 digit forms and passes through others', () => {
        expect(formatTs('20260703143012')).toBe('2026-07-03 14:30:12');
        expect(formatTs('20260703')).toBe('2026-07-03');
        expect(formatTs('n/a')).toBe('n/a');
        expect(formatTs(undefined)).toBe('');
    });
});
