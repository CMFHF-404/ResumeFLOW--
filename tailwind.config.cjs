const dynamicThemeColors = ['blue', 'orange', 'amber', 'emerald', 'indigo', 'rose'];

const dynamicThemeColorClasses = dynamicThemeColors.flatMap((color) => [
  `bg-${color}-50`,
  `bg-${color}-600`,
  `hover:bg-${color}-50`,
  `hover:bg-${color}-700`,
  `text-${color}-600`,
  `hover:text-${color}-600`,
  `group-hover:text-${color}-600`,
  `text-${color}-400`,
  `border-${color}-500`,
  `hover:border-${color}-600`,
  `focus:border-${color}-500`,
  `focus:ring-${color}-500/20`,
  `shadow-${color}-500/20`,
  `dark:bg-${color}-900/20`,
  `dark:text-${color}-400`,
]);

module.exports = {
  content: [
    './index.html',
    './{components,constants,hooks,services,utils,views}/**/*.{ts,tsx}',
    './App.tsx',
    './index.tsx',
  ],
  darkMode: 'class',
  safelist: dynamicThemeColorClasses,
  theme: {
    extend: {
      colors: {
        primary: '#0F766E',
        'primary-dark': '#115E59',
        'background-light': '#F9FAFB',
        'background-dark': '#111827',
        'surface-light': '#FFFFFF',
        'surface-dark': '#1F2937',
        'border-light': '#E5E7EB',
        'border-dark': '#374151',
      },
      fontFamily: {
        display: ['Noto Sans SC', 'Inter', 'sans-serif'],
        body: ['Noto Sans SC', 'Inter', 'sans-serif'],
      },
    },
  },
  plugins: [
    require('@tailwindcss/forms'),
    require('@tailwindcss/typography'),
    require('@tailwindcss/container-queries'),
  ],
};
