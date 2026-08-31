import { redirect } from "next/navigation";

/** `/settings` ouvre le premier onglet. */
export default function SettingsIndexPage() {
  redirect("/settings/general");
}
