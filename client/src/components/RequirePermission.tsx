import { Link } from 'react-router-dom';
import { Lock, Loader2 } from 'lucide-react';
import { Button, Card, EmptyState } from '@/components/ui';
import { usePermissions } from '@/lib/permissions';

/**
 * Wraps a screen a role reaches through the permission grid rather than by being
 * a manager. A built-in OWNER passes (it holds every permission), so screens
 * moved from RequireManager to this behave the same for the three built-in
 * roles; a custom role passes only when its grid grants the action. The API
 * enforces the same check — this just meets a denied user with an explanation
 * instead of a page that fills with 403s.
 */
export function RequirePermission({
  resource, action = 'view', children,
}: {
  resource: string;
  action?: 'view' | 'add' | 'edit' | 'delete' | 'see_prices';
  children: React.ReactNode;
}) {
  const { can, isManager, isLoading } = usePermissions();

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-brand-500" />
      </div>
    );
  }

  if (!isManager && !can(resource, action)) {
    return (
      <Card className="p-6">
        <EmptyState
          icon={<Lock className="size-8" />}
          title="لا تملك صلاحية لهذه الشاشة"
          message="حسابك لا يملك صلاحية الوصول إلى هذه الشاشة. تواصل مع مدير النظام إذا كنت تحتاجها."
          action={<Link to="/"><Button variant="primary">العودة إلى الرئيسية</Button></Link>}
        />
      </Card>
    );
  }

  return <>{children}</>;
}
