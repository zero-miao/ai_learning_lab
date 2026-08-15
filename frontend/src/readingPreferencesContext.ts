import { createContext } from 'react';

export type ReaderFont = 'system' | 'song' | 'kai' | 'serif';

export interface ReadingPreferences {
  font: ReaderFont;
  voice: string;
  rate: number;
  update: (values: {
    font?: ReaderFont;
    voice?: string;
    rate?: number;
  }) => Promise<void>;
}

export const ReadingPreferencesContext =
  createContext<ReadingPreferences | null>(null);
