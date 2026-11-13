const groupedTokens = new Intl.NumberFormat();
const compactTokenDigits = [1, 2].map(maximumFractionDigits =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits, useGrouping: false, roundingMode: 'halfEven' }));

function compactTokens(value) {
  const amount = Math.abs(value);
  if (amount < 1_000) return String(value);
  if (amount < 999_950) return compactTokenDigits[0].format(value / 1_000) + 'K';
  if (amount < 999_950_000) return compactTokenDigits[0].format(value / 1_000_000) + 'M';
  return compactTokenDigits[1].format(value / 1_000_000_000) + 'B';
}
