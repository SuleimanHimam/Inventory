import { useState } from 'react';
import { ConfirmDialog } from '@/components/ui';
import { signOut } from '@/lib/session';

/** Confirm-before-logout, shared by the desktop ribbon's account menu and the phone nav sheet. */
export function useSignOut() {
  const [open, setOpen] = useState(false);

  const dialog = (
    <ConfirmDialog
      open={open}
      onClose={() => setOpen(false)}
      onConfirm={() => signOut()}
      title="تسجيل الخروج"
      message="سيتم إنهاء جلستك الحالية، وستحتاج لتسجيل الدخول مرة أخرى للمتابعة."
      confirmLabel="تسجيل الخروج"
      tone="danger"
    />
  );

  return { askToSignOut: () => setOpen(true), dialog };
}
