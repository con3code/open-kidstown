import {describe, it, expect} from 'vitest';
import {createHash} from 'node:crypto';
import {sha256Hex, cardAddress, normalizeIdm, isIdm, toFiniteNumber} from '../src/hash';

const ref = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

describe('sha256Hex', () => {
    it('matches the known test vector', async () => {
        expect(await sha256Hex('abc'))
            .toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    });
    it('matches node:crypto for multibyte strings', async () => {
        expect(await sha256Hex('kt.balance')).toBe(ref('kt.balance'));
        expect(await sha256Hex('ぎんこう')).toBe(ref('ぎんこう'));
    });
});

describe('cardAddress (numberbank 互換)', () => {
    it('computes bank_key / card_key / docId like numberbank computeHashes', async () => {
        const a = await cardAddress('kt.balance', '012e48b0b10c999b');
        expect(a.bankKey).toBe(ref('kt.balance'));
        expect(a.cardKey).toBe(ref('012e48b0b10c999b'));
        expect(a.docId).toBe(ref('kt.balance' + '012e48b0b10c999b'));
    });
    it('trims BANK/CARD before hashing (trim済み入力で numberbank と一致)', async () => {
        const a = await cardAddress(' kt.balance ', ' abc ');
        expect(a.docId).toBe(ref('kt.balanceabc'));
        expect(a.bankKey).toBe(ref('kt.balance'));
    });
});

describe('helpers', () => {
    it('normalizeIdm lowers and trims', () => {
        expect(normalizeIdm(' 012E48B0B10C999B ')).toBe('012e48b0b10c999b');
    });
    it('isIdm validates 16-hex', () => {
        expect(isIdm('012e48b0b10c999b')).toBe(true);
        expect(isIdm('shop.B06')).toBe(false);
        expect(isIdm('012E48B0B10C999B')).toBe(false); // 正規化前は不可
    });
    it('toFiniteNumber matches numberbank semantics', () => {
        expect(toFiniteNumber('1200')).toBe(1200);
        expect(toFiniteNumber('', 5)).toBe(5);
        expect(toFiniteNumber('abc')).toBe(0);
        expect(toFiniteNumber(null, 7)).toBe(7);
    });
});
