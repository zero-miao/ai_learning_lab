import { useContext } from 'react';
import { ReadingPreferencesContext } from '../readingPreferencesContext';

export function useReadingPreferences() {
  const value = useContext(ReadingPreferencesContext);
  if (!value) throw new Error('ReadingPreferencesProvider is missing.');
  return value;
}
