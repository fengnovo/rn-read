import { requireNativeModule } from 'expo-modules-core';

export interface DocumentEntry {
  name: string;
  uri: string;
  isDirectory: boolean;
  size: number | null;
  identity: string;
}
export interface DocumentIdentity {
  /** Resolved granted root; persist together with a returned bookmark. Never replace it with a child uri. */
  rootUri: string;
  identity: string;
  uri: string;
  bookmark?: string;
}
export interface DirectoryListing {
  /** Resolved granted root, distinct from the directory currently being listed. */
  rootUri: string;
  entries: DocumentEntry[];
  bookmark?: string;
}
export interface DocumentAccessNative {
  identity(uri: string, bookmark: string | null): Promise<DocumentIdentity>;
  listDirectory(uri: string, bookmark: string | null): Promise<DirectoryListing>;
  resolveRelative(rootUri: string, relativePath: string, bookmark: string | null): Promise<DocumentIdentity>;
  copyToLocal(uri: string, destination: string, bookmark: string | null): Promise<void>;
}

const native = requireNativeModule<DocumentAccessNative>('DocumentAccess');

export const identity = (uri: string, bookmark: string | null = null): Promise<DocumentIdentity> =>
  native.identity(uri, bookmark);
export const listDirectory = (uri: string, bookmark: string | null = null): Promise<DirectoryListing> =>
  native.listDirectory(uri, bookmark);
/** Pass a decoded filename path. URL-reference percent encoding must be decoded once upstream. */
export const resolveRelative = (rootUri: string, relativePath: string, bookmark: string | null = null): Promise<DocumentIdentity> =>
  native.resolveRelative(rootUri, relativePath, bookmark);
/** Destination must be a file URL below the app's persistent Documents root. */
export const copyToLocal = (uri: string, destination: string, bookmark: string | null = null): Promise<void> =>
  native.copyToLocal(uri, destination, bookmark);

export default { identity, listDirectory, resolveRelative, copyToLocal };
