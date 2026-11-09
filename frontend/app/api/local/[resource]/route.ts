import { localApi } from "../../../../lib/local-api";

async function handle(request: Request, context: { params: Promise<{ resource: string }> }) {
  const { resource } = await context.params;
  return localApi(request, resource);
}

export { handle as GET, handle as PUT, handle as POST };
