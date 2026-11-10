"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@Kavero/ui/components/alert-dialog";
import { useEffect, useState } from "react";

export type ConfirmOptions = {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

type PendingConfirm = { options: ConfirmOptions; resolve: (confirmed: boolean) => void };
let showConfirm: ((request: PendingConfirm) => void) | null = null;

/** Show the app's shared accessible confirmation dialog and resolve after a choice. */
export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    if (!showConfirm) {
      resolve(false);
      return;
    }
    showConfirm({ options, resolve });
  });
}

export function ConfirmDialogHost() {
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  useEffect(() => {
    showConfirm = setPending;
    return () => {
      showConfirm = null;
    };
  }, []);

  function settle(confirmed: boolean) {
    pending?.resolve(confirmed);
    setPending(null);
  }

  return (
    <AlertDialog open={!!pending} onOpenChange={(open) => !open && settle(false)}>
      {pending && (
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pending.options.title}</AlertDialogTitle>
            <AlertDialogDescription className="whitespace-pre-line">{pending.options.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => settle(false)}>{pending.options.cancelLabel ?? "Cancel"}</AlertDialogCancel>
            <AlertDialogAction
              variant={pending.options.destructive ? "destructive" : "default"}
              onClick={() => settle(true)}
            >
              {pending.options.confirmLabel ?? "Continue"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      )}
    </AlertDialog>
  );
}
