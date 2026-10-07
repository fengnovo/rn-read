# DocumentAccess

Local Expo module for RN Read development builds. Expo automatically autolinks this folder on Apple/Android; Expo Go cannot load it.

The four exports are `identity`, `listDirectory`, `resolveRelative`, and `copyToLocal`. Bookmark arguments default to `null` in JavaScript and are nullable in native AsyncFunctions. Identity/directory/relative responses include `rootUri` and can include an updated iOS bookmark. Persist **`rootUri` together with `bookmark`** whenever maintaining the granted directory; this is essential after a directory moves. `uri` points to the current document or child; never save that child URI as the directory root. Listing a subdirectory still returns the bookmarked directory's granted root in `rootUri`. For a standalone file bookmark, `rootUri` is that file's resolved URI. For ordinary sandbox paths without bookmarks, identity/list return their input root, while relative resolution returns the passed directory root. `copyToLocal` returns no bookmark, so resolve or identify a bookmarked source before copying when maintaining its long-term reference.

On Android, select directories through `@react-native-documents/picker` with long-term access. The picker owns taking/releasing the persisted SAF grant. The module checks access through ContentResolver and walks child document IDs using DocumentsContract; it never concatenates content URI paths. A standalone file grant does not authorize its parent directory. The bookmark argument is unused on Android because permission is represented by the persisted URI grant. Tree child responses return the canonical SAF tree root in `rootUri`; relative resolution of an internal file returns the supplied directory root.

On iOS, picker bookmarks are Base64 minimal bookmarks. Every operation resolves and scopes the bookmark's root, including when the requested URI refers to one of that directory's children. Reading uses NSFileCoordinator. Stale bookmarks are refreshed; bookmark data includes the original root path so a moved root can remap a child's relative location. If a provider's old bookmark lacks that path and the root moved, reauthorization may be required. Files imported into the app sandbox do not require security scope.

`resolveRelative` expects a **decoded filename path**, e.g. `章节/../图片/100% 图.png`. Decode URL-reference percent encoding once in the application resolver before this call. Native code keeps literal percent signs, normalizes dot segments, and rejects paths that escape the root, absolute paths, schemes, backslashes, and NUL. Symlinks that escape the authorized root are rejected. The root must be a directory; pass the granted directory URI and the document's root-relative location for Markdown assets.

`copyToLocal` requires a `file://` destination below the persistent app Documents root (`context.filesDir` on Android, Foundation `.documentDirectory` on iOS). Existing destinations are rejected. Copies use bounded 128 KiB streams, sync the completed temporary file, and move it into place. Failed copies remove the temporary file. The application must recover `.document-access-*.partial` files left by abrupt process termination during its storage recovery pass. Native code never deletes the original source.

Pure Swift path/identity/bookmark regression tests on macOS:

```sh
node modules/document-access/tests/run.mjs
```

The moved-directory regression creates a real Foundation bookmark, moves its root, renews the bookmark, persists the resolved `rootUri`, and reopens the directory and child twice. These tests do not verify a device's provider permissions, iCloud downloads, bookmark restoration after reboot, or actual PDF import performance. See `docs/native-access-report.md` for checks performed.
