import { Link } from 'react-router-dom';
import { Lock, Loader2 } from 'lucide-react';
import { Button, Card, EmptyState } from '@/components/ui';
import { usePermissions } from '@/lib/permissions';

/**
 * Wraps a screen that only a manager may open.
 *
 * The API refuses these routes on its own — this is what stands in the way of
 * a staff user who typed the URL, so that they meet an explanation instead of
 * a screen that loads and then fills with 403 toasts.
 *
 * While the role is still loading it renders a spinner rather than the refusal:
 * a manager should never see "ليس لديك صلاحية" flash before their own page.
 */
export function RequireManager({ children }: { children: React.ReactNode }) {
  const { isManager, isLoading } = usePermissions();

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-brand-500" />
      </div>
    );
  }

  if (!isManager) {
    return (
      <Card className="p-6">
        <EmptyState
          icon={<Lock className="size-8" />}
          title="هذه الصفحة للمدير فقط"
          message="حسابك لا يملك صلاحية الوصول إلى هذه الشاشة. تواصل مع مدير النظام إذا كنت تحتاجها."
          action={<Link to="/"><Button variant="primary">العودة إلى لوحة المعلومات</Button></Link>}
        />
      </Card>
    );
  }

  return <>{children}</>;
}
