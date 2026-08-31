import { redirect } from "next/navigation";

/** `/settings` opens the first tab. */
export default function SettingsIndexPage() {
  redirect("/settings/general");
}
