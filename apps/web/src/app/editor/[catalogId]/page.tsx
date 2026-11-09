import { CatalogEditorPage } from "@/modules/editor/editor-shell";

export default async function EditorPage({ params }: { params: Promise<{ catalogId: string }> }) {
  const { catalogId } = await params;
  return <CatalogEditorPage catalogId={catalogId} />;
}
