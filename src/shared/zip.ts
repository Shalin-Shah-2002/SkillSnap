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
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export async function buildZipBlob(files: Record<string, string>): Promise<Blob> {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(files)) {
    zip.file(path, content);
  }
  return zip.generateAsync({ type: "blob" });
}

export async function buildZipBase64(files: Record<string, string>): Promise<string> {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(files)) {
    zip.file(path, content);
  }
  return zip.generateAsync({ type: "base64" });
}

export function packageFilesToMap(pkg: {
  skillName: string;
  skillMd: string;
  referenceMd: string;
  transcriptMd: string;
}): Record<string, string> {
  return {
    [`${pkg.skillName}/SKILL.md`]: pkg.skillMd,
    [`${pkg.skillName}/references/video-summary.md`]: pkg.referenceMd,
    [`${pkg.skillName}/references/full-transcript.md`]: pkg.transcriptMd
  };
}
