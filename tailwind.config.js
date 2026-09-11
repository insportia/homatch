import tailwindAnimate from 'tailwindcss-animate';
import containerQuery from '@tailwindcss/container-queries';
import intersect from 'tailwindcss-intersect';

export default {
    darkMode: ['class'],
    content: [
        './index.html',
        './pages/**/*.{ts,tsx}',
        './components/**/*.{ts,tsx}',
        './app/**/*.{ts,tsx}',
        './src/**/*.{ts,tsx}',
        './node_modules/streamdown/dist/**/*.js'
    ],
    safelist: ['border', 'border-border'],
    prefix: '',
    theme: {
        container: {
            center: true,
            padding: '2rem',
            screens: {
                '2xl': '1400px'
            }
        },
        extend: {
            /* ----------------------------------------------------------------
             * THE TYPE SCALE
             *
             * Redefined rather than left at Tailwind's defaults, because the
             * app leans on two of these steps almost exclusively: text-xs and
             * text-sm account for 1,142 usages across src/. At Tailwind's
             * defaults that is 12px and 14px, which is why a measurement sweep
             * found 107 of 139 text nodes on the home page below 15px, and
             * paragraphs on /mortgage at 12px.
             *
             * Changing the scale here fixes all of them at once and keeps the
             * fix in one reviewable place, instead of scattering overrides
             * through 86 files.
             *
             * Every step carries its own line-height. A size without a
             * matching leading is how dense text ends up at 1.2 and long-form
             * ends up cramped; pairing them means picking a size also picks a
             * sane rhythm (roughly 1.6 for reading sizes, tighter as the type
             * grows, per the readability pass).
             * -------------------------------------------------------------- */
            fontSize: {
                /* Truly minor metadata only: timestamps, source ids, counts. */
                '2xs': ['0.75rem', { lineHeight: '1.45' }],      /* 12px */
                /* Badges, eyebrows, table meta. Was 12px. */
                xs: ['0.8125rem', { lineHeight: '1.45' }],       /* 13px */
                /* The workhorse secondary size. Was 14px. */
                sm: ['0.9375rem', { lineHeight: '1.6' }],        /* 15px */
                /* Body. Was 16px. */
                base: ['1.0625rem', { lineHeight: '1.65' }],     /* 17px */
                /* Long-form report body and card titles. */
                lg: ['1.1875rem', { lineHeight: '1.6' }],        /* 19px */
                xl: ['1.375rem', { lineHeight: '1.45' }],        /* 22px */
                '2xl': ['1.625rem', { lineHeight: '1.3' }],      /* 26px */
                '3xl': ['2rem', { lineHeight: '1.22' }],         /* 32px */
                '4xl': ['2.5rem', { lineHeight: '1.15' }],       /* 40px */
                '5xl': ['3.25rem', { lineHeight: '1.08' }],      /* 52px */
            },
            colors: {
                border: 'hsl(var(--border))',
                borderColor: {
                    border: 'hsl(var(--border))'
                },
                input: 'hsl(var(--input))',
                ring: 'hsl(var(--ring))',
                background: 'hsl(var(--background))',
                foreground: 'hsl(var(--foreground))',
                primary: {
                    DEFAULT: 'hsl(var(--primary))',
                    foreground: 'hsl(var(--primary-foreground))'
                },
                secondary: {
                    DEFAULT: 'hsl(var(--secondary))',
                    foreground: 'hsl(var(--secondary-foreground))'
                },
                destructive: {
                    DEFAULT: 'hsl(var(--destructive))',
                    foreground: 'hsl(var(--destructive-foreground))'
                },
                muted: {
                    DEFAULT: 'hsl(var(--muted))',
                    foreground: 'hsl(var(--muted-foreground))'
                },
                accent: {
                    DEFAULT: 'hsl(var(--accent))',
                    foreground: 'hsl(var(--accent-foreground))'
                },
                popover: {
                    DEFAULT: 'hsl(var(--popover))',
                    foreground: 'hsl(var(--popover-foreground))'
                },
                card: {
                    DEFAULT: 'hsl(var(--card))',
                    foreground: 'hsl(var(--card-foreground))'
                },
                success: 'hsl(var(--success))',
                warning: 'hsl(var(--warning))',
                info: 'hsl(var(--info))',
                // Homatch brand values (see the light-surface block in
                // index.css). Kept separate from `accent` because `accent` is
                // a shadcn *role* — hover surfaces, muted highlights — while
                // these are the brand's gold/sand/ink, used for rules, brand
                // marks and warm panels.
                gold: {
                    DEFAULT: 'hsl(var(--gold))',
                    // The text-safe gold. --gold is 2.6:1 on warm-white and
                    // must never carry type on a light ground; this is 5.7:1.
                    ink: 'hsl(var(--gold-ink))',
                    soft: 'hsl(var(--gold-soft))'
                },
                sand: 'hsl(var(--sand))',
                'ink-soft': 'hsl(var(--ink-soft))',
                sidebar: {
                    DEFAULT: 'hsl(var(--sidebar-background))',
                    background: 'hsl(var(--sidebar-background))',
                    foreground: 'hsl(var(--sidebar-foreground))',
                    primary: 'hsl(var(--sidebar-primary))',
                    'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
                    accent: 'hsl(var(--sidebar-accent))',
                    'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
                    border: 'hsl(var(--sidebar-border))',
                    ring: 'hsl(var(--sidebar-ring))'
                },
                chart: {
                    '1': 'hsl(var(--chart-1))',
                    '2': 'hsl(var(--chart-2))',
                    '3': 'hsl(var(--chart-3))',
                    '4': 'hsl(var(--chart-4))',
                    '5': 'hsl(var(--chart-5))'
                }
            },
            borderRadius: {
                lg: 'var(--radius)',
                md: 'calc(var(--radius) - 2px)',
                sm: 'calc(var(--radius) - 4px)'
            },
            backgroundImage: {
                'gradient-primary': 'var(--gradient-primary)',
                'gradient-card': 'var(--gradient-card)',
                'gradient-background': 'var(--gradient-background)'
            },
            fontFamily: {
                /* The two role stacks, defined once in index.css so every
                   script gets a face designed for it. */
                sans: ['var(--font-body)'],
                display: ['var(--font-display)'],
            },
            boxShadow: {
                card: 'var(--shadow-card)',
                hover: 'var(--shadow-hover)',
                /* Restrained lift for a white card on the neutral page: two
                   very low-opacity layers rather than one dark one, so the
                   edge stays soft instead of reading as a drop shadow. */
                'card-soft': '0 1px 2px hsl(0 0% 0% / 0.04), 0 4px 16px hsl(0 0% 0% / 0.04)',
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
                },
                'fade-in': {
                    from: {
                        opacity: '0',
                        transform: 'translateY(10px)'
                    },
                    to: {
                        opacity: '1',
                        transform: 'translateY(0)'
                    }
                },
                'slide-in': {
                    from: {
                        opacity: '0',
                        transform: 'translateX(-20px)'
                    },
                    to: {
                        opacity: '1',
                        transform: 'translateX(0)'
                    }
                }
            },
            animation: {
                'accordion-down': 'accordion-down 0.2s ease-out',
                'accordion-up': 'accordion-up 0.2s ease-out',
                'fade-in': 'fade-in 0.5s ease-out forwards',
                'slide-in': 'slide-in 0.5s ease-out forwards'
            }
        }
    },
    plugins: [
        tailwindAnimate,
        containerQuery,
        intersect,
        function ({addUtilities}) {
            addUtilities(
                {
                    '.border-t-solid': {'border-top-style': 'solid'},
                    '.border-r-solid': {'border-right-style': 'solid'},
                    '.border-b-solid': {'border-bottom-style': 'solid'},
                    '.border-l-solid': {'border-left-style': 'solid'},
                    '.border-t-dashed': {'border-top-style': 'dashed'},
                    '.border-r-dashed': {'border-right-style': 'dashed'},
                    '.border-b-dashed': {'border-bottom-style': 'dashed'},
                    '.border-l-dashed': {'border-left-style': 'dashed'},
                    '.border-t-dotted': {'border-top-style': 'dotted'},
                    '.border-r-dotted': {'border-right-style': 'dotted'},
                    '.border-b-dotted': {'border-bottom-style': 'dotted'},
                    '.border-l-dotted': {'border-left-style': 'dotted'},
                },
                ['responsive']
            );
        },
    ],
};
