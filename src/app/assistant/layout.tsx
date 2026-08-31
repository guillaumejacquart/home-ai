import { redirect } from "next/navigation";

import { getSession } from "@/lib/session";

export default async function AssistantLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  return <>{children}</>;
}
