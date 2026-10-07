import Foundation

struct AccessLocation {
  let uri: URL
  /// The bookmark's granted root, even when uri points to a child or subdirectory.
  let rootUri: String
}

enum AccessBookmark {
  /// Call inside the resolved root's active security scope.
  static func location(requested: URL, root: URL, bookmarkData: Data) throws -> AccessLocation {
    guard try root.resourceValues(forKeys: [.isDirectoryKey]).isDirectory == true else {
      return AccessLocation(uri: root, rootUri: root.absoluteString)
    }
    let oldValues = NSURL.resourceValues(forKeys: [.pathKey], fromBookmarkData: bookmarkData)
    let oldRoot = (oldValues?[.pathKey] as? String).map {
      URL(fileURLWithPath: $0, isDirectory: true).standardizedFileURL
    }
    var target = requested
    let requestedParts = AccessPath.canonical(requested).pathComponents
    if let oldRoot, requestedParts.starts(with: AccessPath.canonical(oldRoot).pathComponents) {
      target = root
      for component in requestedParts.dropFirst(AccessPath.canonical(oldRoot).pathComponents.count) {
        target.appendPathComponent(component)
      }
    } else if !AccessPath.contains(root, requested) {
      throw AccessPath.failure("Requested file is outside the bookmarked directory")
    }
    guard AccessPath.contains(root, target) else { throw AccessPath.failure("Requested file leaves bookmarked directory") }
    return AccessLocation(uri: target, rootUri: root.absoluteString)
  }
}
