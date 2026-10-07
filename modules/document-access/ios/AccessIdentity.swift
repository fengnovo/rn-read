import CryptoKit
import Foundation

enum AccessIdentity {
  static func stableIdentity(_ url: URL) throws -> String {
    let values = try url.resourceValues(forKeys: [.fileResourceIdentifierKey, .volumeIdentifierKey])
    if let identifier = values.fileResourceIdentifier {
      let volume = values.volumeIdentifier ?? "" as NSString
      let data = try NSKeyedArchiver.archivedData(withRootObject: [volume, identifier], requiringSecureCoding: false)
      return "ios:resource:" + SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
    // Some providers omit resource IDs. Keep the canonical source URL as fallback;
    // the application's resourceId remains persistent after first registration.
    return "ios:url:" + AccessPath.canonical(url).absoluteString
  }
}
