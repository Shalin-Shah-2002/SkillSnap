import JSZip from "jszip";

export async function downloadZipFile(params: {
  fileName: string;
  files: Record<string, string>;
}): Promise<void> {
  const zip = new JSZip();

  for (const [path, content] of Object.entries(params.files)) {
    zip.file(path, content);
  }

  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = params.fileName;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
