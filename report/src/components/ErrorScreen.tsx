import { Card } from "@/components/ui/card";
import type { Strings } from "@/lib/i18n";

export function ErrorScreen({ message, t }: { message: string; t: Strings }) {
  return (
    <div className="mx-auto max-w-xl p-6">
      <Card className="gap-2 rounded-lg px-6 py-5">
        <h1 className="text-lg font-semibold">{t.errorTitle}</h1>
        <p className="text-muted-foreground">{message}</p>
      </Card>
    </div>
  );
}
