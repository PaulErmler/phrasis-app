export function damerauLevenshtein(
  a: string[] | string,
  b: string[] | string,
): number {
  const aArr = typeof a === 'string' ? Array.from(a) : a;
  const bArr = typeof b === 'string' ? Array.from(b) : b;
  const n = aArr.length;
  const m = bArr.length;
  if (n === 0) return m;
  if (m === 0) return n;

  const d: number[][] = Array.from({ length: n + 1 }, () =>
    new Array(m + 1).fill(0),
  );
  for (let i = 0; i <= n; i++) d[i][0] = i;
  for (let j = 0; j <= m; j++) d[0][j] = j;

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = aArr[i - 1] === bArr[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + cost,
      );
      if (
        i > 1 &&
        j > 1 &&
        aArr[i - 1] === bArr[j - 2] &&
        aArr[i - 2] === bArr[j - 1]
      ) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[n][m];
}
