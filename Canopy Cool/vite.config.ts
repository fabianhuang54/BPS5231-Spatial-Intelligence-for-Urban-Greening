import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// relative base so the build can be opened from any path (GitHub Pages, a USB stick, a lab server)
export default defineConfig({ base: './', plugins: [react()] });
