import { dictionaries, type Dict } from "@/i18n/locales";
import { useAppStore } from "@/store/use-app-store";

export function useT(): Dict {
  const locale = useAppStore((s) => s.locale);
  return dictionaries[locale];
}
