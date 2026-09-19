/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0A0E14',
        panel: '#0D131C',
        recess: '#101823',
        edge: '#1C2731',
        accent: '#2DD4BF',
        warn: '#F5A623',
        live: '#34D399',
        t1: '#E6EDF3',
        t2: '#8A97A6',
        t3: '#7E8EA0'
      },
      borderColor: {
        hair: 'rgba(255,255,255,0.08)'
      },
      fontFamily: {
        sans: ['Inter', 'SF Pro Text', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'IBM Plex Mono', 'ui-monospace', 'SFMono-Regular', 'monospace']
      },
      fontSize: {
        label: ['11px', { lineHeight: '14px', letterSpacing: '0.14em' }]
      },
      letterSpacing: {
        label: '0.14em'
      }
    }
  },
  plugins: []
};
