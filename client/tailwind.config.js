/** @type {import('tailwindcss').Config} */
export default { content: ['./index.html', './src/**/*.{js,jsx}'], darkMode: 'class', theme: { extend: { colors: { ink: '#17212b', forest: '#236b55', mint: '#e8f3ee' }, boxShadow: { soft: '0 8px 28px rgba(25, 45, 38, .06)' }, fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui'] } } }, plugins: [] };
