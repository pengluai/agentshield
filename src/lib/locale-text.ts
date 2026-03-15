import { isEnglishLocale } from '@/constants/i18n';

const CJK_REGEX = /[\u3400-\u9FFF]/;

export function containsCjk(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }
  return CJK_REGEX.test(value);
}

export function localizedDynamicText(value: string, englishFallback: string): string {
  if (!isEnglishLocale) {
    return value;
  }
  if (containsCjk(value)) {
    return englishFallback;
  }
  return value;
}
