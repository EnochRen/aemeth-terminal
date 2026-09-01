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
import { useAppStore } from "@/store/use-app-store";

export function DeleteDialog() {
  const target = useAppStore((s) => s.deleteTarget);
  const requestDelete = useAppStore((s) => s.requestDelete);
  const deleteApp = useAppStore((s) => s.deleteApp);

  return (
    <AlertDialog open={target !== null} onOpenChange={(o) => !o && requestDelete(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除「{target?.name}」？</AlertDialogTitle>
          <AlertDialogDescription>
            该应用的配置将被永久删除；若其终端正在运行，会一并停止。此操作无法撤销。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction onClick={() => void deleteApp()}>删除</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
