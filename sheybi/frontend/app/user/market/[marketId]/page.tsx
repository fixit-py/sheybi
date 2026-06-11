import MarketTradePanel from "@/components/MarketTradePanel";

export default async function MarketPage({
  params,
}: {
  params: Promise<{ marketId: string }>;
}) {
  const { marketId } = await params;

  return (
    <main className="flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 py-10">
      <MarketTradePanel marketId={marketId} />
    </main>
  );
}
