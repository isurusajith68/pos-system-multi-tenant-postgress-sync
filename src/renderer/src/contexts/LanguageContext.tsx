import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { FALLBACK_LANGUAGE, SupportedLanguage, translations } from "../i18n/translations";

type TranslationVariables = Record<string, string | number>;

interface LanguageContextValue {
  language: SupportedLanguage;
  changeLanguage: (language: SupportedLanguage) => void;
  t: (key: string, vars?: TranslationVariables) => string;
}

const LanguageContext = createContext<LanguageContextValue | undefined>(undefined);

const resolveLanguage = (lang?: string | null): SupportedLanguage => {
  if (!lang) return FALLBACK_LANGUAGE;
  return ["en", "si"].includes(lang) ? (lang as SupportedLanguage) : FALLBACK_LANGUAGE;
};

const translate = (
  language: SupportedLanguage,
  key: string,
  vars?: TranslationVariables
): string => {
  const languageDictionary = translations[language] ?? translations[FALLBACK_LANGUAGE];
  const fallbackDictionary = translations[FALLBACK_LANGUAGE];

  const template = languageDictionary[key] ?? fallbackDictionary[key] ?? key;

  if (!vars) {
    return template;
  }

  return template.replace(/\{(.*?)\}/g, (match, token) => {
    const value = vars[token.trim()];
    return value !== undefined ? String(value) : match;
  });
};

interface LanguageProviderProps {
  children: React.ReactNode;
}

export const LanguageProvider: React.FC<LanguageProviderProps> = ({ children }) => {
  const [language, setLanguage] = useState<SupportedLanguage>(FALLBACK_LANGUAGE);

  useEffect(() => {
    const loadLanguagePreference = async () => {
      try {
        const localPreference = localStorage.getItem("pos_language");
        if (localPreference) {
          setLanguage(resolveLanguage(localPreference));
        }

        if (window?.api?.settings?.findMany) {
          const settings = await window.api.settings.findMany();
          if (Array.isArray(settings)) {
            const languageSetting = settings.find((setting: any) => setting.key === "language");
            if (languageSetting?.value) {
              setLanguage(resolveLanguage(languageSetting.value));
            }
          }
        }
      } catch (error) {
        console.error("LanguageProvider: failed to load language settings", error);
      }
    };

    loadLanguagePreference();
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
    localStorage.setItem("pos_language", language);
  }, [language]);

  const changeLanguage = useCallback((nextLanguage: SupportedLanguage) => {
    setLanguage(resolveLanguage(nextLanguage));
  }, []);

  const translateFn = useCallback(
    (key: string, vars?: TranslationVariables) => translate(language, key, vars),
    [language]
  );

  const contextValue = useMemo(
    () => ({
      language,
      changeLanguage,
      t: translateFn
    }),
    [language, changeLanguage, translateFn]
  );

  return <LanguageContext.Provider value={contextValue}>{children}</LanguageContext.Provider>;
};

export const useLanguage = (): LanguageContextValue => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error("useLanguage must be used within a LanguageProvider");
  }

  return context;
};

export const useTranslation = () => {
  const { t, language, changeLanguage } = useLanguage();
  return { t, language, changeLanguage };
};
