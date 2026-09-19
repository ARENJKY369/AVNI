// Hand-cut 24px stroke icons. Kept intentionally a little irregular —
// instrument panels are drawn by engineers, not by a brand kit.

const PATHS = {
  upload: ['M12 15V4', 'm-5 5 5-5 5 5', 'M4 17v2.5h16V17'],
  download: ['M12 4v11', 'm-5-5 5 5 5-5', 'M4 19.5h16'],
  file: ['M13.5 3H7.5a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V7z', 'M13.5 3v4h4'],
  check: ['M5 12.5l4.6 4.7L19 7'],
  refresh: ['M19.5 12a7.5 7.5 0 1 1-2.2-5.3', 'M19.7 3.8v4h-4'],
  warn: ['M12 4.2 2.8 19.8h18.4z', 'M12 10v4.2', 'M12 16.9v.2'],
  expand: ['M4 9V4h5', 'M15 4h5v5', 'M20 15v5h-5', 'M9 20H4v-5'],
  pen: ['M4 20l1.2-4.2L16.6 4.4a2.05 2.05 0 0 1 3 3L8.2 18.8z'],
  paperclip: ['M8.7 12.3l5.8-5.8a2.9 2.9 0 0 1 4.1 4.1l-7.7 7.7a4.8 4.8 0 0 1-6.8-6.8l7.4-7.4'],
  comment: ['M4 5.5h16v10.5h-10L6 19.6V16H4z'],
  send: ['M12 18.5v-13', 'M6.5 11 12 5.5 17.5 11'],
  x: ['M6 6l12 12', 'M18 6 6 18'],
  chevron: ['M7 9.5l5 5 5-5'],
  crosshair: ['M12 5.2v-2', 'M12 20.8v-2', 'M5.2 12h-2', 'M20.8 12h-2', 'M12 8.6a3.4 3.4 0 1 0 .01 0z'],
  layers: ['M12 3.5 20.5 8.2 12 13 3.5 8.2z', 'M4.5 12.4 12 16.6l7.5-4.2', 'M4.5 16.2 12 20.4l7.5-4.2'],
  grid: ['M4 4h6.7v6.7H4z', 'M13.3 4H20v6.7h-6.7z', 'M4 13.3h6.7V20H4z', 'M13.3 13.3H20V20h-6.7z'],
  model: ['M12 3.5 14.3 9.7 20.5 12l-6.2 2.3L12 20.5 9.7 14.3 3.5 12l6.2-2.3z'],
  droplet: ['M12 3.5s5.8 6.4 5.8 10.6a5.8 5.8 0 0 1-11.6 0C6.2 9.9 12 3.5 12 3.5z'],
  radar: ['M4.5 10.5a7.5 7.5 0 0 1 15 0', 'M7.5 13.3a4.5 4.5 0 0 1 9 0', 'M12 16.5v.2'],
  replay: ['M4.5 4.5v4.6h4.6', 'M5.2 9.1a7.5 7.5 0 1 1-.7 4.4'],
  info: ['M12 11v5.5', 'M12 7.6v.2', 'M12 3.8a8.2 8.2 0 1 0 .01 0z'],
  flag: ['M5.5 20.5v-16', 'M5.5 4.5h11.5l-2.4 3.8 2.4 3.7H5.5'],
  clock: ['M12 7.5V12l3 2', 'M12 3.8a8.2 8.2 0 1 0 .01 0z'],
  hash: ['M9.5 3.5 7.5 20.5', 'M16.5 3.5l-2 17', 'M4 8.5h16.5', 'M3.5 15.5H20'],
  plus: ['M12 5.5v13', 'M5.5 12h13'],
  minus: ['M5.5 12h13'],
  split: ['M12 3v18', 'M5 7 3 12l2 5', 'M19 7l2 5-2 5'],
  eye: ['M3 12s3.4-6 9-6 9 6 9 6-3.4 6-9 6-9-6-9-6z', 'M12 10.2a1.9 1.9 0 1 0 .01 0z'],
  north: ['M12 4.5 16 19l-4-3.4L8 19z']
};

export function Icon({ name, size = 16, className = '', sw = 1.6 }) {
  const d = PATHS[name];
  if (!d) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {d.map((p, i) => (
        <path key={i} d={p} />
      ))}
    </svg>
  );
}

// The AVNI mark — अवनि, "the earth". A framed scene tile with the
// apex of an A read as a scan ridge.
export function AvniMark({ size = 30 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-label="AVNI">
      <rect x="0.5" y="0.5" width="31" height="31" rx="7" fill="#101823" stroke="#1C2731" />
      <path d="M6 6v3.4M26 6v3.4M6 26v-3.4M26 26v-3.4" stroke="#5B6B7A" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M16 8.2 24.2 24h-4L16 15.9 11.8 24h-4L16 8.2Z" fill="#2DD4BF" />
      <path d="M13.1 19.6h5.8" stroke="#0D131C" strokeWidth="1.5" />
    </svg>
  );
}
