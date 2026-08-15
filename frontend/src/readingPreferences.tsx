import {
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  getSystemConfiguration,
  setApiTimeout,
  updateCurrentReadingPreferences,
} from './api';
import { applySiteTheme } from './appearance';
import {
  ReadingPreferencesContext,
  type ReaderFont,
  type ReadingPreferences,
} from './readingPreferencesContext';

export function ReadingPreferencesProvider({ children }: { children: ReactNode }) {
  const [font, setFont] = useState<ReaderFont>(
    () => (window.localStorage.getItem('reader-font') as ReaderFont) || 'system',
  );
  const [voice, setVoice] = useState(
    () => window.localStorage.getItem('reader-tts-voice') ?? '',
  );
  const [rate, setRate] = useState(
    () => Number(window.localStorage.getItem('reader-speech-rate')) || 1,
  );

  useEffect(() => {
    void getSystemConfiguration()
      .then(({ data }) => {
        setApiTimeout(data.api_timeout_ms);
        applySiteTheme(data.current_site_theme);
        setFont(data.current_reader_font);
        setVoice(data.current_tts_voice);
        setRate(data.current_speech_rate);
        window.localStorage.setItem('reader-font', data.current_reader_font);
        window.localStorage.setItem('reader-tts-voice', data.current_tts_voice);
        window.localStorage.setItem(
          'reader-speech-rate',
          String(data.current_speech_rate),
        );
      })
      .catch(() => undefined);
  }, []);

  const value = useMemo<ReadingPreferences>(
    () => ({
      font,
      voice,
      rate,
      update: async (values) => {
        if (values.font !== undefined) {
          setFont(values.font);
          window.localStorage.setItem('reader-font', values.font);
        }
        if (values.voice !== undefined) {
          setVoice(values.voice);
          window.localStorage.setItem('reader-tts-voice', values.voice);
        }
        if (values.rate !== undefined) {
          setRate(values.rate);
          window.localStorage.setItem('reader-speech-rate', String(values.rate));
        }
        await updateCurrentReadingPreferences({
          ...(values.font === undefined
            ? {}
            : { current_reader_font: values.font }),
          ...(values.voice === undefined
            ? {}
            : { current_tts_voice: values.voice }),
          ...(values.rate === undefined
            ? {}
            : { current_speech_rate: values.rate }),
        });
      },
    }),
    [font, rate, voice],
  );

  return (
    <ReadingPreferencesContext.Provider value={value}>
      {children}
    </ReadingPreferencesContext.Provider>
  );
}
