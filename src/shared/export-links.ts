export const OPEN_EXPORT_FOLDER_HREF_PREFIX = "#open-export-folder=";

export function createOpenExportFolderHref(filePath: string): string {
  return `${OPEN_EXPORT_FOLDER_HREF_PREFIX}${encodeURIComponent(filePath)}`;
}

export function getOpenExportFolderPath(href?: string): string | null {
  if (!href?.startsWith(OPEN_EXPORT_FOLDER_HREF_PREFIX)) {
    return null;
  }

  const encodedPath = href.slice(OPEN_EXPORT_FOLDER_HREF_PREFIX.length);
  if (!encodedPath) {
    return null;
  }

  try {
    const filePath = decodeURIComponent(encodedPath);
    return filePath.trim() ? filePath : null;
  } catch {
    return null;
  }
}
