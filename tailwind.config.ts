import type { Config } from "tailwindcss";

const config: Config = {
    darkMode: ["class"],
    content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
  	extend: {
  		colors: {
  			background: 'hsl(var(--background))',
  			foreground: 'hsl(var(--foreground))',
  			card: {
  				DEFAULT: 'hsl(var(--card))',
  				foreground: 'hsl(var(--card-foreground))'
  			},
  			popover: {
  				DEFAULT: 'hsl(var(--popover))',
  				foreground: 'hsl(var(--popover-foreground))'
  			},
  			primary: {
  				DEFAULT: 'hsl(var(--primary))',
  				foreground: 'hsl(var(--primary-foreground))'
  			},
  			secondary: {
  				DEFAULT: 'hsl(var(--secondary))',
  				foreground: 'hsl(var(--secondary-foreground))'
  			},
  			muted: {
  				DEFAULT: 'hsl(var(--muted))',
  				foreground: 'hsl(var(--muted-foreground))'
  			},
  			accent: {
  				DEFAULT: 'hsl(var(--accent))',
  				foreground: 'hsl(var(--accent-foreground))'
  			},
  			destructive: {
  				DEFAULT: 'hsl(var(--destructive))',
  				foreground: 'hsl(var(--destructive-foreground))'
  			},
  			border: 'hsl(var(--border))',
  			input: 'hsl(var(--input))',
  			ring: 'hsl(var(--ring))',
  			chart: {
  				'1': 'hsl(var(--chart-1))',
  				'2': 'hsl(var(--chart-2))',
  				'3': 'hsl(var(--chart-3))',
  				'4': 'hsl(var(--chart-4))',
  				'5': 'hsl(var(--chart-5))'
  			},
  			sidebar: {
  				DEFAULT: 'hsl(var(--sidebar-background))',
  				foreground: 'hsl(var(--sidebar-foreground))',
  				primary: 'hsl(var(--sidebar-primary))',
  				'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
  				accent: 'hsl(var(--sidebar-accent))',
  				'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
  				border: 'hsl(var(--sidebar-border))',
  				ring: 'hsl(var(--sidebar-ring))'
  			}
  		},
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)'
  		},
  		keyframes: {
  			'accordion-down': {
  				from: {
  					height: '0'
  				},
  				to: {
  					height: 'var(--radix-accordion-content-height)'
  				}
  			},
  			'accordion-up': {
  				from: {
  					height: 'var(--radix-accordion-content-height)'
  				},
  				to: {
  					height: '0'
  				}
  			}
  		},
  		animation: {
  			'accordion-down': 'accordion-down 0.2s ease-out',
  			'accordion-up': 'accordion-up 0.2s ease-out'
  		}
  	}
  },
  safelist: [
    // ── Status badges (STATUS_CFG, t.cls, cfg.badge, cfg.dot) ─────────────────
    'bg-amber-50','bg-amber-100','bg-amber-400','bg-amber-500',
    'text-amber-700','text-amber-800','ring-amber-200','border-amber-100','border-amber-200',
    'bg-emerald-50','bg-emerald-100','bg-emerald-400','bg-emerald-600',
    'text-emerald-700','text-emerald-800','ring-emerald-200','border-emerald-100','border-emerald-200',
    'bg-blue-50','bg-blue-100','bg-blue-400','bg-blue-500','bg-blue-600',
    'text-blue-500','text-blue-600','text-blue-700','text-blue-800','text-blue-900',
    'ring-blue-200','border-blue-100','border-blue-200','border-blue-500',
    'bg-yellow-50','bg-yellow-100','bg-yellow-400',
    'text-yellow-700','text-yellow-800','ring-yellow-200',
    'bg-red-50','bg-red-100','bg-red-400',
    'text-red-600','text-red-700','text-red-800','ring-red-200','border-red-200','border-red-500',
    'bg-violet-50','bg-violet-100','bg-violet-500','bg-violet-600',
    'text-violet-600','text-violet-700','text-violet-800','text-violet-900',
    'ring-violet-200','border-violet-100','border-violet-200',
    'bg-purple-50','bg-purple-100','bg-purple-600',
    'text-purple-600','text-purple-700','text-purple-900',
    'ring-purple-200','border-purple-200',
    'bg-orange-100','text-orange-800',
    'bg-cyan-100','text-cyan-800',
    'bg-indigo-100','text-indigo-800',
    'bg-sky-100','text-sky-800',
    'bg-pink-100','text-pink-800',
    'bg-green-50','bg-green-100',
    'text-green-600','text-green-700','text-green-800',
    'border-green-200','border-green-500',
    // ── Step/log border colors ─────────────────────────────────────────────────
    'border-blue-500','border-green-500','border-red-500','border-yellow-500',
    // ── Skeleton heights ───────────────────────────────────────────────────────
    'h-16','h-20',
    // ── Submit button variants ─────────────────────────────────────────────────
    'bg-blue-600','hover:bg-blue-700',
    'bg-purple-600','hover:bg-purple-700',
    'bg-emerald-600','hover:bg-emerald-700',
    // ── Text color variants ────────────────────────────────────────────────────
    'text-blue-500','text-violet-500',
  ],
  plugins: [require("tailwindcss-animate")],
};
export default config;
