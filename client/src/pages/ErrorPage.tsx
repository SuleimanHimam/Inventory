import { Link, useRouteError, useNavigate } from 'react-router-dom';
import { Compass, RotateCw, House, TriangleAlert } from 'lucide-react';
import { Button, Card, EmptyState } from '@/components/ui';

/**
 * Two dead ends, deliberately written as different screens.
 *
 * `NotFound` is a wrong address — nothing is broken, the user just typed or
 * followed a bad link, so it stays inside the app shell (navigation intact)
 * and reads as a gentle redirect rather than a failure. It replaced a silent
 * `<Navigate to="/">`, which left people wondering why they'd been moved.
 *
 * `RouteError` is an actual crash. It renders standalone, because whatever
 * failed may well be the shell itself, and it offers a reload first — the
 * one action that fixes most transient front-end failures.
 */

export function NotFound() {
  return (
    <Card className="mx-auto max-w-lg">
      <EmptyState
        icon={<Compass className="size-7" />}
        tone="brand"
        title="لم نجد هذه الصفحة"
        message="الرابط الذي فتحته غير موجود — ربما تغيّر أو كتب بشكل غير صحيح. لا شيء في بياناتك تأثّر."
        action={
          <Link to="/">
            <Button variant="primary" size="lg" icon={<House className="size-4" />}>
              العودة إلى الصفحة الرئيسية
            </Button>
          </Link>
        }
      />
    </Card>
  );
}

export function RouteError() {
  const error = useRouteError();
  const navigate = useNavigate();
  // Shown only as supporting detail — the heading and the action above it
  // stay in plain language, since the message itself is usually developer
  // text that means nothing to the person reading it.
  const detail = error instanceof Error ? error.message : null;

  return (
    <div className="grid min-h-dvh place-items-center bg-page px-4 py-10">
      <Card className="w-full max-w-lg">
        <EmptyState
          icon={<TriangleAlert className="size-7" />}
          tone="warning"
          title="حدث خطأ غير متوقع"
          message="تعذّر عرض هذه الصفحة. عادةً ما يحل تحديث الصفحة المشكلة — بياناتك محفوظة ولم تتأثر."
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button variant="primary" size="lg" icon={<RotateCw className="size-4" />}
                onClick={() => window.location.reload()}>
                تحديث الصفحة
              </Button>
              <Button size="lg" icon={<House className="size-4" />}
                onClick={() => { navigate('/'); window.location.reload(); }}>
                الصفحة الرئيسية
              </Button>
            </div>
          }
        />
        {detail && (
          <details className="border-t border-line px-5 py-3">
            <summary className="cursor-pointer text-xs font-semibold text-subtle">
              تفاصيل تقنية
            </summary>
            <p className="mt-2 break-words font-mono text-[11px] leading-relaxed text-muted" dir="ltr">
              {detail}
            </p>
          </details>
        )}
      </Card>
    </div>
  );
}
