/**
 * Truncates a string in the middle, counting the ellipsis toward `maxLength`.
 * When the kept character count is odd, the head receives the extra character.
 */
export function truncateMiddle(value: string, maxLength: number): string {
  if (maxLength < 1) {
    throw new RangeError("maxLength must be at least 1");
  }

  if (value.length <= maxLength) {
    return value;
  }

  const keep = maxLength - 1;
  const headLen = Math.ceil(keep / 2);
  const tailLen = Math.floor(keep / 2);
  const tail = tailLen === 0 ? "" : value.slice(value.length - tailLen);

  return `${value.slice(0, headLen)}…${tail}`;
}
