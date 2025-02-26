import { get } from "idb-keyval";
import { join } from "path";
import index from "public/.index/fs.9p.json";
import { FS_HANDLES } from "utils/constants";

type BFSFS = { [key: string]: BFSFS | null };
type FS9PV3 = [
  string,
  number,
  number,
  number,
  number,
  number,
  FS9PV3[] | string
];
type FS9PV4 = [string, number, number, FS9PV4[] | string | undefined];
type FS9P = {
  fsroot: FS9PV3[];
  size: number;
  version: 3;
};

const IDX_MTIME = 2;
const IDX_TARGET = 3;
const IDX_FILE_MODE = 33206;
const IDX_DIR_MODE = 16822;
const IDX_UID = 0;
const IDX_GID = 0;
// eslint-disable-next-line unicorn/no-null
const FILE_ENTRY = null;
const fsroot = index.fsroot as FS9PV4[];

export const get9pModifiedTime = (path: string): number => {
  let fsPath = fsroot;
  let mTime = 0;

  path
    .split("/")
    .filter(Boolean)
    .forEach((pathPart) => {
      const pathBranch = fsPath.find(([name]) => name === pathPart);

      if (pathBranch) {
        const isBranch = Array.isArray(pathBranch[IDX_TARGET]);

        if (!isBranch) mTime = pathBranch[IDX_MTIME];
        fsPath = isBranch ? (pathBranch[IDX_TARGET] as FS9PV4[]) : [];
      }
    });

  return mTime;
};

const mapReduce9pArray = (
  array: FS9PV4[],
  mapper: (entry: FS9PV4) => BFSFS
  // eslint-disable-next-line unicorn/no-array-callback-reference
): BFSFS => array.map(mapper).reduce((a, b) => Object.assign(a, b), {});

// eslint-disable-next-line unicorn/no-unreadable-array-destructuring
const parse9pEntry = ([name, , , pathOrArray]: FS9PV4): BFSFS => ({
  [name]: Array.isArray(pathOrArray)
    ? mapReduce9pArray(pathOrArray, parse9pEntry)
    : FILE_ENTRY,
});

export const fs9pToBfs = (): BFSFS => mapReduce9pArray(fsroot, parse9pEntry);

const parse9pV4ToV3 = (fs9p: FS9PV4[], path = "/"): FS9PV3[] =>
  fs9p.map(([name, mtime, size, target]) => {
    const targetPath = join(path, name);
    const isDirectory = Array.isArray(target);
    const newTarget = isDirectory
      ? parse9pV4ToV3(target, targetPath)
      : target || targetPath;

    return [
      name,
      mtime,
      size,
      isDirectory ? IDX_DIR_MODE : IDX_FILE_MODE,
      IDX_UID,
      IDX_GID,
      newTarget,
    ] as FS9PV3;
  });

export const fs9pV4ToV3 = (): FS9P =>
  index.version === 4
    ? {
        fsroot: parse9pV4ToV3(fsroot),
        size: index.size,
        version: 3,
      }
    : (index as FS9P);

export const supportsIndexedDB = (): Promise<boolean> =>
  new Promise((resolve) => {
    const db = window.indexedDB.open("");

    db.addEventListener("error", () => resolve(false));
    db.addEventListener("success", () => {
      resolve(true);

      try {
        db.result.close();
        window.indexedDB.deleteDatabase("");
      } catch {
        // Ignore errors to close/delete the test database
      }
    });
  });

export const getFileSystemHandles = async (): Promise<
  Record<string, FileSystemDirectoryHandle>
> => ((await supportsIndexedDB()) && (await get(FS_HANDLES))) || {};

export const addFileSystemHandle = async (
  directory: string,
  handle: FileSystemDirectoryHandle
): Promise<void> => {
  if (!(await supportsIndexedDB())) return;

  const { set } = await import("idb-keyval");

  await set(FS_HANDLES, {
    ...(await getFileSystemHandles()),
    [join(directory, handle.name)]: handle,
  });
};

export const removeFileSystemHandle = async (
  directory: string
): Promise<void> => {
  if (!(await supportsIndexedDB())) return;

  const { [directory]: _, ...handles } = await getFileSystemHandles();
  const { set } = await import("idb-keyval");

  await set(FS_HANDLES, handles);
};

export const requestPermission = async (
  url: string
): Promise<PermissionState | false> => {
  const fsHandles = await getFileSystemHandles();
  const handle = fsHandles[url];

  if (handle) {
    if ((await handle.queryPermission()) === "prompt") {
      await handle.requestPermission();
    }

    return handle.queryPermission();
  }

  return false;
};
