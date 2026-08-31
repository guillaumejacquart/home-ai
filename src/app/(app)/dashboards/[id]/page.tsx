import { DashboardEditor } from "@/components/DashboardEditor";

export default async function DashboardDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DashboardEditor dashboardId={id} />;
}
