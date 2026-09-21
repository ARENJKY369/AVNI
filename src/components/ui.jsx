export function Dot({ tone = 'live', pulse = false, className = '' }) {
  const color = tone === 'warn' ? '#F5A623' : tone === 'accent' ? '#2DD4BF' : '#34D399';
  return (
    <span
      className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${pulse ? 'pulse-live' : ''} ${className}`}
      style={{ background: color }}
    />
  );
}

// consistency ring — the confidence glyph used inline with every answer
export function Ring({ score, size = 30, aborted = false }) {
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const color = aborted ? '#F5A623' : score >= 0.7 ? '#2DD4BF' : '#F5A623';
  return (
    <span className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="#1C2731" strokeWidth="3" fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth="3"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${c * Math.max(0.03, score)} ${c}`}
        />
      </svg>
      <span className="absolute font-mono text-[9px]" style={{ color }}>
        {aborted ? '×' : score.toFixed(2).replace('0.', '.')}
      </span>
    </span>
  );
}

// σ0 shown against a real dB axis instead of decorative bars: the marker is
// the reading, the ticks are the scale, and the axis range is stated.
const DB_MIN = -25;
const DB_MAX = 0;
const AXIS_W = 96;

export function DbScale({ db, tone = '#F5A623' }) {
  const value = Math.min(DB_MAX, Math.max(DB_MIN, db));
  const x = ((value - DB_MIN) / (DB_MAX - DB_MIN)) * (AXIS_W - 6) + 3;
  return (
    <svg
      width={AXIS_W}
      height={28}
      role="img"
      aria-label={`sigma0 ${db.toFixed(1)} decibels on a ${DB_MIN} to ${DB_MAX} decibel scale`}
    >
      <line x1="3" y1="11" x2={AXIS_W - 3} y2="11" stroke="#1C2731" strokeWidth="3" strokeLinecap="round" />
      {[-25, -20, -15, -10, -5, 0].map((t) => {
        const tx = ((t - DB_MIN) / (DB_MAX - DB_MIN)) * (AXIS_W - 6) + 3;
        const major = t % 10 === 0;
        return (
          <line
            key={t}
            x1={tx}
            y1={major ? 6 : 8}
            x2={tx}
            y2={major ? 16 : 14}
            stroke="#5B6B7A"
            strokeWidth="1"
          />
        );
      })}
      <circle cx={x} cy="11" r="3.4" fill={tone} />
      <text x="0" y="26" fill="#728293" fontSize="7" fontFamily="ui-monospace, monospace">
        {DB_MIN}
      </text>
      <text x={AXIS_W} y="26" fill="#728293" fontSize="7" textAnchor="end" fontFamily="ui-monospace, monospace">
        {DB_MAX}
      </text>
    </svg>
  );
}
