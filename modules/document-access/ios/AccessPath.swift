import Foundation

/// Relative paths are decoded filename components, never URL-encoded references.
enum AccessPath {
  static func relativeComponents(_ path: String) throws -> [String] {
    guard !path.hasPrefix("/"), !path.contains("\\"), !path.contains("\0"),
          !(path.split(separator: "/", omittingEmptySubsequences: false).first?.contains(":") ?? false) else {
      throw failure("Invalid relative path")
    }
    var components: [String] = []
    for component in path.split(separator: "/") {
      if component == "." { continue }
      if component == ".." {
        guard !components.isEmpty else { throw failure("Relative path leaves authorized root") }
        components.removeLast()
      } else { components.append(String(component)) }
    }
    return components
  }

  static func canonical(_ url: URL) -> URL { canonical(url, depth: 0) }

  private static func canonical(_ url: URL, depth: Int) -> URL {
    // Fail containment closed for cycles or unusually deep symbolic-link chains.
    guard depth < 64 else { return URL(fileURLWithPath: "/.document-access-invalid-symlink") }
    var ancestor = url.standardizedFileURL
    var missing: [String] = []
    while !FileManager.default.fileExists(atPath: ancestor.path), ancestor.path != "/" {
      if let link = try? FileManager.default.destinationOfSymbolicLink(atPath: ancestor.path) {
        let linkURL = link.hasPrefix("/") ? URL(fileURLWithPath: link)
          : ancestor.deletingLastPathComponent().appendingPathComponent(link)
        var resolved = canonical(linkURL, depth: depth + 1)
        for component in missing.reversed() { resolved.appendPathComponent(component) }
        return resolved.standardizedFileURL
      }
      missing.append(ancestor.lastPathComponent)
      ancestor.deleteLastPathComponent()
    }
    var resolved = ancestor.resolvingSymlinksInPath()
    for component in missing.reversed() { resolved.appendPathComponent(component) }
    return resolved.standardizedFileURL
  }

  static func contains(_ root: URL, _ candidate: URL) -> Bool {
    let rootParts = canonical(root).pathComponents
    let candidateParts = canonical(candidate).pathComponents
    return candidateParts.starts(with: rootParts)
  }

  static func fileURL(_ value: String) throws -> URL {
    guard let url = URL(string: value), url.isFileURL,
          url.host == nil || url.host == "" || url.host == "localhost",
          url.query == nil, url.fragment == nil else { throw failure("Expected a local file URL") }
    return url.standardizedFileURL
  }

  static func failure(_ message: String) -> NSError {
    NSError(domain: "DocumentAccess", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
  }
}
