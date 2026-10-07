import ExpoModulesCore
import Foundation

public final class DocumentAccessModule: Module {
  public func definition() -> ModuleDefinition {
    Name("DocumentAccess")

    AsyncFunction("identity") { (uri: String, bookmark: String?) -> [String: Any] in
      try self.withAccess(uri, bookmark: bookmark) { url, renewed, rootUri in
        var result = try self.identityResult(url)
        result["rootUri"] = rootUri
        if let renewed { result["bookmark"] = renewed }
        return result
      }
    }

    AsyncFunction("listDirectory") { (uri: String, bookmark: String?) -> [String: Any] in
      try self.withAccess(uri, bookmark: bookmark) { url, renewed, rootUri in
        let entries = try self.coordinatedRead(url) { coordinated in
          guard try coordinated.resourceValues(forKeys: [.isDirectoryKey]).isDirectory == true else {
            throw AccessPath.failure("Source is not a directory")
          }
          return try FileManager.default.contentsOfDirectory(
            at: coordinated,
            includingPropertiesForKeys: [.isDirectoryKey, .isRegularFileKey, .fileSizeKey, .fileResourceIdentifierKey, .volumeIdentifierKey],
            options: []
          ).sorted { $0.lastPathComponent < $1.lastPathComponent }.map { child -> [String: Any] in
            guard AccessPath.contains(coordinated, child) else { throw AccessPath.failure("Child leaves authorized directory") }
            let values = try child.resourceValues(forKeys: [.isDirectoryKey, .isRegularFileKey, .fileSizeKey])
            return ["name": child.lastPathComponent, "uri": child.absoluteString,
                    "isDirectory": values.isDirectory == true,
                    "size": values.isRegularFile == true ? (values.fileSize.map { $0 as Any } ?? NSNull()) : NSNull(),
                    "identity": try AccessIdentity.stableIdentity(child)]
          }
        }
        var result: [String: Any] = ["entries": entries, "rootUri": rootUri]
        if let renewed { result["bookmark"] = renewed }
        return result
      }
    }

    AsyncFunction("resolveRelative") { (rootUri: String, relativePath: String, bookmark: String?) -> [String: Any] in
      let components = try AccessPath.relativeComponents(relativePath)
      return try self.withAccess(rootUri, bookmark: bookmark) { root, renewed, grantedRootUri in
        guard try root.resourceValues(forKeys: [.isDirectoryKey]).isDirectory == true else {
          throw AccessPath.failure("Select the parent directory to resolve relative files")
        }
        var child = root
        for component in components { child.appendPathComponent(component) }
        guard AccessPath.contains(root, child) else { throw AccessPath.failure("Relative path leaves authorized root") }
        var result = try self.identityResult(child)
        result["rootUri"] = grantedRootUri
        if let renewed { result["bookmark"] = renewed }
        return result
      }
    }

    AsyncFunction("copyToLocal") { (uri: String, destination: String, bookmark: String?) in
      let destinationURL = try AccessPath.fileURL(destination)
      let documents = try FileManager.default.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
      guard AccessPath.contains(documents, destinationURL),
            AccessPath.canonical(documents) != AccessPath.canonical(destinationURL) else {
        throw AccessPath.failure("Destination must be a file below app Documents")
      }
      try self.withAccess(uri, bookmark: bookmark) { source, _, _ in
        try self.coordinatedRead(source) { readable in
          guard try readable.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile == true else {
            throw AccessPath.failure("Source is not a regular file")
          }
          let parent = destinationURL.deletingLastPathComponent()
          try FileManager.default.createDirectory(at: parent, withIntermediateDirectories: true)
          guard AccessPath.contains(documents, parent) else { throw AccessPath.failure("Destination leaves app Documents") }
          guard !FileManager.default.fileExists(atPath: destinationURL.path) else { throw AccessPath.failure("Destination already exists") }
          let temporary = parent.appendingPathComponent(".document-access-\(UUID().uuidString).partial")
          defer { try? FileManager.default.removeItem(at: temporary) }
          try self.streamCopy(readable, to: temporary)
          let handle = try FileHandle(forWritingTo: temporary)
          do { try handle.synchronize(); try handle.close() }
          catch { try? handle.close(); throw error }
          // Moving a complete sibling file prevents exposing partial imports on failure.
          try FileManager.default.moveItem(at: temporary, to: destinationURL)
        }
      }
    }
  }

  private func withAccess<T>(_ uri: String, bookmark: String?, body: (URL, String?, String) throws -> T) throws -> T {
    let requested = try AccessPath.fileURL(uri)
    var target = requested
    var scope = requested
    var stale = false
    var bookmarkData: Data?
    if let bookmark {
      guard let data = Data(base64Encoded: bookmark) else { throw AccessPath.failure("Invalid bookmark") }
      bookmarkData = data
      // iOS restores implicit security scope from minimalBookmark data; macOS-only
      // withSecurityScope flags are intentionally omitted. Explicit start/stop owns the scope.
      scope = try URL(resolvingBookmarkData: data, options: [.withoutUI, .withoutImplicitStartAccessing],
                      relativeTo: nil, bookmarkDataIsStale: &stale)
    }
    let didStart = scope.startAccessingSecurityScopedResource()
    defer { if didStart { scope.stopAccessingSecurityScopedResource() } }
    // start returns false for ordinary sandbox URLs, where no security scope is needed.
    let sandbox = URL(fileURLWithPath: NSHomeDirectory(), isDirectory: true)
    guard didStart || AccessPath.contains(sandbox, scope) else { throw AccessPath.failure("Document permission is unavailable; select it again") }

    let rootUri: String
    if let data = bookmarkData {
      let location = try AccessBookmark.location(requested: requested, root: scope, bookmarkData: data)
      target = location.uri
      rootUri = location.rootUri
    } else {
      rootUri = scope.absoluteString
    }

    var renewed = bookmark
    if stale || (bookmark == nil && didStart) {
      renewed = try scope.bookmarkData(options: .minimalBookmark, includingResourceValuesForKeys: [.pathKey], relativeTo: nil).base64EncodedString()
    }
    return try body(target, renewed, rootUri)
  }

  private func coordinatedRead<T>(_ url: URL, body: (URL) throws -> T) throws -> T {
    let coordinator = NSFileCoordinator(filePresenter: nil)
    var coordinationError: NSError?
    var result: Result<T, Error>?
    coordinator.coordinate(readingItemAt: url, options: .withoutChanges, error: &coordinationError) { readable in
      result = Result { try body(readable) }
    }
    if let coordinationError { throw coordinationError }
    guard let result else { throw AccessPath.failure("Provider did not complete coordinated access") }
    return try result.get()
  }

  private func identityResult(_ url: URL) throws -> [String: Any] {
    try coordinatedRead(url) { readable in
      ["uri": readable.absoluteString, "identity": try AccessIdentity.stableIdentity(readable)]
    }
  }

  private func streamCopy(_ source: URL, to destination: URL) throws {
    guard let input = InputStream(url: source), let output = OutputStream(url: destination, append: false) else {
      throw AccessPath.failure("Cannot open copy streams")
    }
    input.open()
    output.open()
    defer { input.close(); output.close() }
    let capacity = 128 * 1024
    let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: capacity)
    defer { buffer.deallocate() }
    while true {
      let count = input.read(buffer, maxLength: capacity)
      if count == 0 { break }
      if count < 0 { throw input.streamError ?? AccessPath.failure("Document read failed") }
      var offset = 0
      while offset < count {
        let written = output.write(buffer.advanced(by: offset), maxLength: count - offset)
        guard written > 0 else { throw output.streamError ?? AccessPath.failure("Local write failed") }
        offset += written
      }
    }
    if let error = output.streamError { throw error }
  }
}
