export interface NormalizeOptions {
  foldCase?: boolean;
  foldDiacritics?: boolean;
  collapseWhitespace?: boolean;
}

export function normalize(input: string, opts: NormalizeOptions = {}): string {
  let s = input.normalize('NFC');
  if (opts.collapseWhitespace !== false) {
    s = s.replace(/\s+/g, ' ').trim();
  }
  if (opts.foldCase) {
    s = s.toLocaleLowerCase();
  }
  if (opts.foldDiacritics) {
    s = s.normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC');
  }
  return s;
}
