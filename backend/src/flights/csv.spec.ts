import { csvCell, toCsv } from './csv';

describe('csv (FLT-29)', () => {
  it('quotes commas, quotes and line breaks', () => {
    expect(csvCell('Smith, John')).toBe('"Smith, John"');
    expect(csvCell('He said "hi"')).toBe('"He said ""hi"""');
    expect(csvCell('a\nb')).toBe('"a\nb"');
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell(3)).toBe('3');
  });

  it('neutralises spreadsheet formulas', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe(
      `"'=HYPERLINK(""http://x"")"`,
    );
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('-2')).toBe("'-2");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
  });

  it('writes a header and one line per row', () => {
    expect(
      toCsv(
        ['Reference', 'Passenger'],
        [
          ['FB-1', 'Ana'],
          ['FB-2', 'Bo, Jr'],
        ],
      ),
    ).toBe('Reference,Passenger\r\nFB-1,Ana\r\nFB-2,"Bo, Jr"\r\n');
  });
});
