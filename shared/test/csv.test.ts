import {describe, it, expect} from 'vitest';
import {toCsv, parseCsv} from '../src/csv';

describe('toCsv / parseCsv', () => {
    it('escapes commas, quotes, and newlines', () => {
        const rows = [
            ['a', 'b,c', 'd"e', 'f\ng'],
            ['1', '', 'plain', '日本語']
        ];
        const csv = toCsv(rows);
        expect(csv).toBe('a,"b,c","d""e","f\ng"\r\n1,,plain,日本語\r\n');
        expect(parseCsv(csv)).toEqual(rows);
    });

    it('parses BOM and CRLF/LF mixed input', () => {
        expect(parseCsv('﻿no,idm\r\n1001,012e48b0b10c999b\n1002,')).toEqual([
            ['no', 'idm'],
            ['1001', '012e48b0b10c999b'],
            ['1002', '']
        ]);
    });

    it('roundtrips JSON values in cells', () => {
        const json = '{"no":"12","items":[{"name":"けん玉","price":30,"qty":1}]}';
        const back = parseCsv(toCsv([[json]]));
        expect(back).toEqual([[json]]);
    });
});
