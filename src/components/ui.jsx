import { Icon } from './Icons.jsx';

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
      <svg width={size} height={size} className="-rotate-90">
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

// a physics histogram: little dB bars so the callout reads as
// instrumentation, not as a notification banner
export function DbHistogram({ db, tone = '#F5A623' }) {
  // deterministic pseudo-bars centred on the reading
  const seed = Math.abs(Math.round(db * 7)) % 5;
  const bars = [3, 5, 8, 12, 15, 13, 9, 6, 4, 3].map((b, i) => b + ((i + seed) % 3) * 2);
  const peak = 4 + seed;
  return (
    <svg width="96" height="26" aria-hidden="true">
      {bars.map((b, i) => (
        <rect
          key={i}
          x={i * 10}
          y={24 - b}
          width="6"
          height={b}
          rx="1"
          fill={i === peak ? tone : '#1C2731'}
        />
      ))}
      <line x1={peak * 10 + 3} y1="0" x2={peak * 10 + 3} y2="24" stroke={tone} strokeWidth="1" strokeDasharray="2 2" />
    </svg>
  );
}

export function FlagsBadge({ n, onClick, title }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="icon-btn text-warn hover:bg-warn/10 hover:text-warn"
    >
      <Icon name="warn" size={15} />
      {n > 0 && <span className="data-mono -ml-0.5 text-warn">{n}</span>}
    </button>
  );
}
