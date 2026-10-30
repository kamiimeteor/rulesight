import { Card } from "@/components/ui/card";

export function ErrorScreen({ message }: { message: string }) {
  return (
    <div className="mx-auto max-w-xl p-6">
      <Card className="gap-2 rounded-lg px-6 py-5">
        <h1 className="text-lg font-semibold">这份报告打不开</h1>
        <p className="text-muted-foreground">{message}</p>
      </Card>
    </div>
  );
}
