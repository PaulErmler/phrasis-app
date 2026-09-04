import { describe, it, expect } from 'vitest';

import { serbianLatinToCyrillic } from '../../lib/serbianTranslit';

describe('serbianLatinToCyrillic', () => {
  it('converts a sentence the STT model returns in Latin', () => {
    expect(
      serbianLatinToCyrillic('Danas je lep dan. Hajdemo u park u šetnju.'),
    ).toBe('Данас је леп дан. Хајдемо у парк у шетњу.');
  });

  it('reads the digraphs before single letters, in every casing', () => {
    expect(serbianLatinToCyrillic('Ljubljana')).toBe('Љубљана');
    expect(serbianLatinToCyrillic('LJUBLJANA')).toBe('ЉУБЉАНА');
    expect(serbianLatinToCyrillic('NJEGOŠ')).toBe('ЊЕГОШ');
    expect(serbianLatinToCyrillic('Njegoš')).toBe('Његош');
    expect(serbianLatinToCyrillic('džem')).toBe('џем');
    expect(serbianLatinToCyrillic('Džak')).toBe('Џак');
    expect(serbianLatinToCyrillic('DŽAK')).toBe('ЏАК');
  });

  it('covers the letters with diacritics and their capitals', () => {
    expect(serbianLatinToCyrillic('Đorđe Čačak Ćuprija Šabac Žabalj')).toBe(
      'Ђорђе Чачак Ћуприја Шабац Жабаљ',
    );
  });

  it('accepts decomposed diacritics', () => {
    expect(serbianLatinToCyrillic('čas')).toBe('час');
  });

  it('passes digits, punctuation and non-Serbian Latin letters through', () => {
    expect(serbianLatinToCyrillic('U 2026. godini: 100%!')).toBe(
      'У 2026. години: 100%!',
    );
    // q, w, x, y have no Cyrillic counterpart in Gaj's alphabet. Foreign
    // words that mix them with Serbian letters come out mixed-script, which
    // is the honest rendering of a letter-level bijection.
    expect(serbianLatinToCyrillic('q w x y Q W X Y')).toBe('q w x y Q W X Y');
  });
});
