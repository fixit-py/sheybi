import OrderPanel from "@/components/OrderPanel";

export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ marketId: string; optionId: string }>;
  searchParams?: Promise<{ action?: string }>;
}) {
  const { marketId, optionId } = await params;
  const query = (await searchParams) ?? {};
  const initialAction = query.action === "sell" ? "sell" : "buy";

  return (
    <main className="flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 py-10">
      <OrderPanel marketId={marketId} optionId={optionId} initialAction={initialAction} />
    </main>
  );
}
