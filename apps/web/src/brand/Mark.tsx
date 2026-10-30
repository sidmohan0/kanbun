/** The kanbun mark: a bar and three cards, one lit. Inline so it takes the current theme. */
export function Mark({ size = 20, lit = true }: { size?: number; lit?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="kanbun">
      <rect x="8" y="8" width="11" height="48" rx="5.5" fill="var(--text)" />
      <rect x="34" y="8" width="22" height="13" rx="4.5" fill="var(--text)" />
      <rect x="23" y="25.5" width="22" height="13" rx="4.5" fill={lit ? "var(--accent)" : "var(--text)"} />
      <rect x="34" y="43" width="22" height="13" rx="4.5" fill="var(--text)" />
    </svg>
  );
}
