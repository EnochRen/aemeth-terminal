import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { fmt } from "@/i18n/locales";
import { useT } from "@/i18n/use-t";
import { useAppStore } from "@/store/use-app-store";

export function DeleteDialog() {
  const t = useT();
  const target = useAppStore((s) => s.deleteTarget);
  const requestDelete = useAppStore((s) => s.requestDelete);
  const deleteApp = useAppStore((s) => s.deleteApp);

  return (
    <AlertDialog open={target !== null} onOpenChange={(o) => !o && requestDelete(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{fmt(t.delete.title, { name: target?.name ?? "" })}</AlertDialogTitle>
          <AlertDialogDescription>{t.delete.desc}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t.delete.cancel}</AlertDialogCancel>
          <AlertDialogAction onClick={() => void deleteApp()}>
            {t.delete.confirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
