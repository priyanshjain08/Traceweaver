import { create } from 'zustand';
export const RANGES = ['15m', '1h', '6h', '24h', '7d'] as const;
export const useRange = create<{ range: string; setRange: (r: string) => void }>((set) => ({ range: '1h', setRange: (range) => set({ range }) }));
