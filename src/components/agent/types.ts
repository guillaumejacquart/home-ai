export interface ThreadRow {
  id: string;
  title: string;
  contextKind: "assistant" | "app" | "script" | "journal";
  contextId: string | null;
  createdAt: string;
  updatedAt: string;
}

export function isJournalRow(row: ThreadRow): boolean {
  return row.contextKind === "journal";
}
