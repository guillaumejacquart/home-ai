import { route } from "@/lib/route";
import { getAppThumb } from "@/services/apps/thumb";

export const dynamic = "force-dynamic";

export const GET = route({
  handler: async ({ user, params }) => {
    const id = (params as { id: string }).id;
    const result = await getAppThumb(user.id, id);
    // Client-side cache 30s, revalidated against updatedAt
    return new Response(JSON.stringify(result), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=30",
      },
    });
  },
});
