export interface DirHandle {
  name: string;
}


export interface FileSystemHandle {
  kind: 'file' | 'directory';
  name: string;
  isSameEntry(other: FileSystemHandle): Promise<boolean>;
  queryPermission(descriptor?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission(descriptor?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
}

export const verifyPermission = async (
  fileHandle: FileSystemHandle,
  readWrite: boolean = false
): Promise<boolean> => {
  const options = { mode: readWrite ? "readwrite" : "read" } as const;
  
  // Check if permission was already granted.
  if ((await fileHandle.queryPermission(options)) === "granted") {
    return true;
  }
  
  // Request permission. If the user grants permission, return true.
  if ((await fileHandle.requestPermission(options)) === "granted") {
    return true;
  }
  
  // The user didn't grant permission, so return false.
  return false;
};

export interface FileSystemWriteOptions {
  keepExistingData?: boolean;
}

export interface FileSystemWritableFileStream extends WritableStream {
  write(data: BufferSource | Blob | string): Promise<void>;
  seek(position: number): Promise<void>;
  truncate(size: number): Promise<void>;
}

export interface FileSystemFileHandle extends FileSystemHandle {
  kind: 'file';
  getFile(): Promise<File>;
  createWritable(options?: FileSystemWriteOptions): Promise<FileSystemWritableFileStream>;
}

export interface FileSystemDirectoryHandle extends FileSystemHandle {
  kind: 'directory';
  values(): AsyncIterableIterator<FileSystemHandle>;
  keys(): AsyncIterableIterator<string>;
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FileSystemDirectoryHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  resolve(possibleDescendant: FileSystemHandle): Promise<string[] | null>;
}

export const getFileTypeFromName = (name: string): string => {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  const typeMap: Record<string, string> = {
    csv: "text/csv",
    json: "application/json",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    xls: "application/vnd.ms-excel",
    parquet: "application/parquet",
    txt: "text/plain",
    md: "text/markdown",
    py: "text/x-python",
    ipynb: "application/x-ipynb+json",
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    h5: "application/x-hdf5",
    hdf5: "application/x-hdf5",
    zarr: "application/zarr",
    npy: "application/x-numpy",
    npz: "application/x-numpy",
  };
  return typeMap[ext] || "application/octet-stream";
};

export const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};

export interface ShowDirectoryPickerOptions {
  mode?: "read" | "readwrite";
  startIn?: FileSystemHandle | string;
}

declare global {
  interface Window {
    showDirectoryPicker(
      options?: ShowDirectoryPickerOptions
    ): Promise<FileSystemDirectoryHandle>;
  }
}

export interface FileInfo {
  name: string;
  size: number;
  type: string;
  path: string;
}

export const addFileToFileList = async (
  entry: FileSystemFileHandle,
  path: string,
  files: FileInfo[]
) => {
  try {
    const file = await entry.getFile();
    files.push({
      name: entry.name,
      size: file.size,
      type: file.type || getFileTypeFromName(entry.name),
      path: path,
    });
  } catch (e) {
    console.warn(`Failed to read file ${entry.name}`, e);
  }
};

export const scanDirectory = async (
  dirHandle: FileSystemDirectoryHandle,
  path: string,
  files: FileInfo[],
  maxFiles = 100
) => {
  if (files.length >= maxFiles) return;

  for await (const entry of dirHandle.values()) {
    if (files.length >= maxFiles) break;

    const entryPath = path ? `${path}/${entry.name}` : entry.name;

    if (entry.kind === "file") {
      await addFileToFileList(entry as FileSystemFileHandle, entryPath, files);
    } else if (entry.kind === "directory") {
      // Skip hidden directories and common non-data directories
      if (
        !entry.name.startsWith(".") &&
        !["node_modules", "__pycache__", ".git"].includes(entry.name)
      ) {
        await scanDirectory(entry as FileSystemDirectoryHandle, entryPath, files, maxFiles);
      }
    }
  }
};

export const prepareFileSummary = (files: FileInfo[]) => {
  const fileTypes = new Map<string, { count: number; totalSize: number }>();
  for (const file of files) {
    const ext = file.name.split(".").pop()?.toLowerCase() || "other";
    const existing = fileTypes.get(ext) || { count: 0, totalSize: 0 };
    fileTypes.set(ext, {
      count: existing.count + 1,
      totalSize: existing.totalSize + file.size,
    });
  }

  const fileSummary = Array.from(fileTypes.entries())
    .map(
      ([ext, info]) =>
        `${info.count} .${ext} file(s) (${formatFileSize(
          info.totalSize
        )} total)`
    )
    .join("\n");

  const sampleFiles = files
    .slice(0, 10)
    .map((f) => `- ${f.path} (${formatFileSize(f.size)})`)
    .join("\n");

  return { fileSummary, sampleFiles };
};

export const generateFallbackDescription = (datasetName: string, datasetDescription: string, fileInfos: FileInfo[]): string => {
  const fileTypes = new Map<string, number>();
  let totalSize = 0;

  for (const file of fileInfos) {
    const ext = file.name.split(".").pop()?.toLowerCase() || "other";
    fileTypes.set(ext, (fileTypes.get(ext) || 0) + 1);
    totalSize += file.size;
  }

  const typeDescriptions: string[] = [];
  const packages: string[] = [];

  if (fileTypes.has("csv")) {
    typeDescriptions.push(
      `${fileTypes.get(
        "csv"
      )} CSV file(s) - use pandas: \`df = pd.read_csv('filename.csv')\``
    );
    packages.push("pandas");
  }
  if (fileTypes.has("json")) {
    typeDescriptions.push(
      `${fileTypes.get(
        "json"
      )} JSON file(s) - use json: \`import json; data = json.load(open('filename.json'))\``
    );
  }
  if (fileTypes.has("xlsx") || fileTypes.has("xls")) {
    typeDescriptions.push(
      `Excel file(s) - use pandas: \`df = pd.read_excel('filename.xlsx')\``
    );
    packages.push("pandas", "openpyxl");
  }
  if (fileTypes.has("parquet")) {
    typeDescriptions.push(
      `Parquet file(s) - use pandas: \`df = pd.read_parquet('filename.parquet')\``
    );
    packages.push("pandas", "pyarrow");
  }
  if (fileTypes.has("h5") || fileTypes.has("hdf5")) {
    typeDescriptions.push(
      `HDF5 file(s) - use h5py: \`import h5py; f = h5py.File('filename.h5', 'r')\``
    );
    packages.push("h5py");
  }

  const uniquePackages = [...new Set(packages)];

  return `# ${datasetName}

${datasetDescription || "Dataset for analysis."}

## File Structure
- Total files: ${fileInfos.length}
- Total size: ${formatFileSize(totalSize)}

## File Types
${
  typeDescriptions.length > 0
    ? typeDescriptions.join("\n")
    : "Various data files"
}

${
  uniquePackages.length > 0
    ? `## Required Packages
\`\`\`
pip install ${uniquePackages.join(" ")}
\`\`\``
    : ""
}

## Usage
Files are available in the \`/data\` directory. Use standard Python file operations or appropriate libraries to access them.`;
};
