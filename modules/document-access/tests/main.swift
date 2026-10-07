import Foundation

var assertions = 0
func check(_ condition: @autoclosure () throws -> Bool, _ message: String) throws {
  assertions += 1
  guard try condition() else { fatalError(message) }
}
func rejects(_ path: String) {
  assertions += 1
  do { _ = try AccessPath.relativeComponents(path); fatalError("accepted unsafe path: \(path)") }
  catch { }
}
try check(AccessPath.relativeComponents("章节/../图片/100% 和 中文.png") == ["图片", "100% 和 中文.png"], "dot segments and Unicode")
try check(AccessPath.relativeComponents("./a//b/../c") == ["a", "c"], "normalization")
try check(AccessPath.relativeComponents("%2e%2e/%252f.png") == ["%2e%2e", "%252f.png"], "do not double decode")
try check(AccessPath.relativeComponents("") == [], "empty selects root")
for path in ["../x", "a/../../x", "/tmp/x", "file:///tmp/x", "https:thing", "a\\b", "a\0b"] { rejects(path) }
let temp = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
try FileManager.default.createDirectory(at: temp, withIntermediateDirectories: true)
defer { try? FileManager.default.removeItem(at: temp) }
let root = temp.appendingPathComponent("root")
let sibling = temp.appendingPathComponent("root-elsewhere")
try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
try FileManager.default.createDirectory(at: sibling, withIntermediateDirectories: true)
try FileManager.default.createSymbolicLink(at: root.appendingPathComponent("escape"), withDestinationURL: sibling)
try check(AccessPath.contains(root, root.appendingPathComponent("images/图.png")), "real child allowed")
try check(!AccessPath.contains(root, sibling.appendingPathComponent("x")), "prefix sibling blocked")
try check(!AccessPath.contains(root, root.appendingPathComponent("escape/x")), "symlink outside root blocked")
try check(AccessPath.contains(root, root), "root allowed")
try FileManager.default.createSymbolicLink(at: root.appendingPathComponent("dangling"), withDestinationURL: sibling.appendingPathComponent("not-created"))
try check(!AccessPath.contains(root, root.appendingPathComponent("dangling/x")), "dangling symlink outside root blocked")
let first = root.appendingPathComponent("one.pdf")
let second = root.appendingPathComponent("two.pdf")
try Data("first".utf8).write(to: first)
try Data("second".utf8).write(to: second)
let originalIdentity = try AccessIdentity.stableIdentity(first)
try check(originalIdentity == AccessIdentity.stableIdentity(first), "identity stable across calls")
try check(originalIdentity != AccessIdentity.stableIdentity(second), "different files have distinct identities")
let renamed = root.appendingPathComponent("renamed.pdf")
try FileManager.default.moveItem(at: first, to: renamed)
try check(originalIdentity == AccessIdentity.stableIdentity(renamed), "resource identity survives rename")

// A real Foundation bookmark must remain usable after renewal and two reopens.
let originalDirectory = temp.appendingPathComponent("bookmark-original")
try FileManager.default.createDirectory(at: originalDirectory, withIntermediateDirectories: true)
let originalChild = originalDirectory.appendingPathComponent("章节.md")
try Data("# content".utf8).write(to: originalChild)
let originalBookmark = try originalDirectory.bookmarkData(options: .minimalBookmark, includingResourceValuesForKeys: [.pathKey], relativeTo: nil)
let movedDirectory = temp.appendingPathComponent("bookmark-moved")
try FileManager.default.moveItem(at: originalDirectory, to: movedDirectory)
var stale = false
let resolvedDirectory = try URL(resolvingBookmarkData: originalBookmark, options: [.withoutUI, .withoutImplicitStartAccessing], relativeTo: nil, bookmarkDataIsStale: &stale)
try check(stale, "moving directory marks bookmark stale")
let firstLocation = try AccessBookmark.location(requested: originalChild, root: resolvedDirectory, bookmarkData: originalBookmark)
try check(AccessPath.canonical(firstLocation.uri) == AccessPath.canonical(movedDirectory.appendingPathComponent("章节.md")), "moved bookmark remaps child")
try check(firstLocation.rootUri == resolvedDirectory.absoluteString, "child response returns granted directory root")
var persistedRoot = try AccessPath.fileURL(firstLocation.rootUri)
var persistedBookmark = try resolvedDirectory.bookmarkData(options: .minimalBookmark, includingResourceValuesForKeys: [.pathKey], relativeTo: nil)
for reopen in 1...2 {
  var nextStale = false
  let scope = try URL(resolvingBookmarkData: persistedBookmark, options: [.withoutUI, .withoutImplicitStartAccessing], relativeTo: nil, bookmarkDataIsStale: &nextStale)
  let directory = try AccessBookmark.location(requested: persistedRoot, root: scope, bookmarkData: persistedBookmark)
  try check(AccessPath.canonical(directory.uri) == AccessPath.canonical(resolvedDirectory), "reopen \(reopen) restores directory")
  let child = try AccessBookmark.location(requested: directory.uri.appendingPathComponent("章节.md"), root: scope, bookmarkData: persistedBookmark)
  try check(child.rootUri == directory.rootUri, "reopen \(reopen) keeps child and root distinct")
  try check(try Data(contentsOf: child.uri) == Data("# content".utf8), "reopen \(reopen) reads child")
  persistedRoot = try AccessPath.fileURL(directory.rootUri)
  persistedBookmark = try scope.bookmarkData(options: .minimalBookmark, includingResourceValuesForKeys: [.pathKey], relativeTo: nil)
}
print("Native helper tests: \(assertions) assertions passed, including moved-directory renewal and two reopens")
